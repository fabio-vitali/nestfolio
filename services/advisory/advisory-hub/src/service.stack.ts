import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags } from '@nestfolio/cdk-constructs';

export class AdvisoryHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-hub',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'advisory-hub', domain: 'advisory', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'AdvisoryBus', {
      eventBusName: naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM for cross-domain discovery
    new StringParameter(this, 'BusArnParam', {
      parameterName: naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Advisory event hub bus ARN',
    });

    // Bedrock model IDs — single source of truth for all advisory services
    new StringParameter(this, 'ModelOpusParam', {
      parameterName: naming.ssmParameterPath('models/opus'),
      stringValue: 'anthropic.claude-opus-4-6-20250501-v1:0',
      description: 'Bedrock model ID for Opus tier',
    });

    new StringParameter(this, 'ModelSonnetParam', {
      parameterName: naming.ssmParameterPath('models/sonnet'),
      stringValue: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
      description: 'Bedrock model ID for Sonnet tier',
    });

    new StringParameter(this, 'ModelHaikuParam', {
      parameterName: naming.ssmParameterPath('models/haiku'),
      stringValue: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      description: 'Bedrock model ID for Haiku tier',
    });

    // Cross-domain forwarding: Advisory --> Investor
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
    });
    new Rule(this, 'ToInvestor', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'DECISION_PACKET_CREATED',
          'USER_CONFIRMATION_REQUESTED',
          'EXPLANATION_GENERATED',
          'DECISION_APPROVED',
          'DECISION_BLOCKED',
          'ESCALATION_TRIGGERED',
          'CIRCUIT_BREAKER_TRIGGERED',
          'CIRCUIT_BREAKER_RESET',
          'INCIDENT_DETECTED',
          'INCIDENT_RESOLVED',
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Advisory --> Execution
    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);
    const toExecutionDlq = new Queue(this, 'ToExecutionDLQ', {
      retentionPeriod: Duration.days(14),
    });
    new Rule(this, 'ToExecution', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'DECISION_APPROVED',
          'USER_CONFIRMED',
          'CIRCUIT_BREAKER_TRIGGERED',
          'CIRCUIT_BREAKER_RESET',
        ],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
    });

    // Monitoring: CloudWatch alarms for EventBridge failures, forwarding DLQs
    new Monitoring(this, 'Monitoring', {
      dlqs: [toInvestorDlq, toExecutionDlq],
      eventBusBusNames: [naming.eventBusName()],
    });

    // Dashboard: CloudWatch dashboard for hub observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'advisory-hub',
      lambdaFunctions: [],
      dlqs: [toInvestorDlq, toExecutionDlq],
      eventBusNames: [naming.eventBusName()],
    });
  }
}
