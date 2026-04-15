import { Construct } from 'constructs';
import { Annotations, Duration } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import type { EventName } from '@nestfolio/event-types';
import { ServiceStack } from './service-stack';
import { State } from './state';

export interface OrchestrationProps {
  /** State construct for DynamoDB/S3 grants. Optional — some orchestrations have no direct state access. */
  state?: State;
  /** Step Functions definition body */
  definitionBody: sfn.DefinitionBody;
  /** Event types that trigger new state machine executions */
  triggers: EventName[];
  /** State machine execution timeout (default: 5 minutes) */
  timeout?: Duration;
  /**
   * Fixed execution name for singleton guard pattern.
   * When set, EventBridge rules are NOT created — the state machine must be
   * triggered programmatically via StartExecution with this name.
   * Step Functions rejects concurrent executions that share a name,
   * providing natural singleton semantics.
   */
  executionName?: string;
}

export class Orchestration extends Construct {
  readonly stateMachine: sfn.StateMachine;
  readonly dlq: Queue;
  /**
   * Fixed execution name for singleton guard pattern.
   * Undefined when the orchestration uses standard EB-triggered execution naming.
   */
  readonly executionName?: string;

  constructor(scope: Construct, id: string, props: OrchestrationProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { eventBus, naming } = serviceStack;

    this.executionName = props.executionName;

    // CloudWatch Logs group for state machine execution logs
    const smName = `${naming.prefix}-${naming.service}-${id.toLowerCase()}`;
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/vendedlogs/states/${smName}`,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // State Machine with operational defaults
    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: smName,
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: props.definitionBody,
      timeout: props.timeout ?? Duration.minutes(5),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // Grant state machine access to State resources
    if (props.state?.table) {
      props.state.getTable().grantReadWriteData(this.stateMachine);
    }
    if (props.state?.bucket) {
      props.state.getBucket().grantReadWrite(this.stateMachine);
    }

    // DLQ for failed event deliveries
    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    // When executionName is set, skip EB rules — the state machine is triggered
    // programmatically via StartExecution(name=executionName) for singleton semantics.
    if (props.executionName && props.triggers.length > 0) {
      Annotations.of(this).addWarningV2(
        '@nestfolio/cdk-constructs:orchestration-triggers-ignored',
        'Orchestration triggers are ignored when executionName is set — trigger programmatically via grantStartExecution()',
      );
    }
    if (!props.executionName) {
      // EventBridge rules — one per trigger event type
      for (const eventType of props.triggers) {
        new Rule(this, `${eventType}Rule`, {
          eventBus,
          eventPattern: { detailType: [eventType] },
          targets: [
            new SfnStateMachine(this.stateMachine, {
              input: RuleTargetInput.fromEventPath('$.detail'),
              deadLetterQueue: this.dlq,
            }),
          ],
        });
      }
    }
  }

  /**
   * Grant a Lambda handler permission to send task token callbacks.
   * @param handler - Lambda function to grant callback permissions to.
   * @param envVarName - Name of the env var for the SF ARN (default: STATE_MACHINE_ARN).
   *   Use a custom name when a Lambda needs callback access to multiple state machines.
   */
  grantCallbackAccess(handler: LambdaFunction, envVarName = 'STATE_MACHINE_ARN'): void {
    this.stateMachine.grantTaskResponse(handler);
    handler.addEnvironment(envVarName, this.stateMachine.stateMachineArn);
  }

  /**
   * Grant a Lambda handler permission to start a new state machine execution.
   * Injects the state machine ARN and (if set) the fixed execution name as env vars.
   * Use this for singleton-guarded orchestrations triggered programmatically.
   * @param handler - Lambda function to grant start execution permissions to.
   * @param arnEnvVar - Name of the env var for the SF ARN (default: STATE_MACHINE_ARN).
   * @param nameEnvVar - Name of the env var for the execution name (default: EXECUTION_NAME).
   */
  grantStartExecution(
    handler: LambdaFunction,
    arnEnvVar = 'STATE_MACHINE_ARN',
    nameEnvVar = 'EXECUTION_NAME',
  ): void {
    this.stateMachine.grantStartExecution(handler);
    handler.addEnvironment(arnEnvVar, this.stateMachine.stateMachineArn);
    if (this.executionName) {
      handler.addEnvironment(nameEnvVar, this.executionName);
    }
  }

  /**
   * Grant the state machine's execution role additional IAM permissions.
   * Use for PutEvents, Lambda invoke, or other service integrations.
   */
  grantExecution(...grants: Array<(grantee: sfn.StateMachine) => void>): void {
    for (const grant of grants) {
      grant(this.stateMachine);
    }
  }
}
