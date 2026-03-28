import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic, ITopic } from 'aws-cdk-lib/aws-sns';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';

export interface StepFunctionsConfig {
  stateMachineArn: string;
  stateMachineName: string;
}

export interface MonitoringProps {
  /** SNS topic for alarm notifications. If not provided, a new topic is created. */
  alarmTopic?: ITopic;
  /** Lambda functions to monitor */
  lambdaFunctions?: IFunction[];
  /** SQS DLQs to monitor */
  dlqs?: IQueue[];
  /** EventBridge bus names to monitor for failed invocations */
  eventBusBusNames?: string[];
  /** Whether an AgentRuntime is present (monitors Bedrock invocation errors) */
  monitorBedrock?: boolean;
  /** Bedrock model IDs to monitor */
  bedrockModelIds?: string[];
  /** Step Functions state machine to monitor */
  stepFunctions?: StepFunctionsConfig;
}

/**
 * MonitoringConstruct -- auto-creates CloudWatch alarms for Lambda, SQS DLQ,
 * EventBridge, and Bedrock resources.
 */
export class Monitoring extends Construct {
  readonly alarmTopic: ITopic;

  constructor(scope: Construct, id: string, props: MonitoringProps = {}) {
    super(scope, id);

    this.alarmTopic = props.alarmTopic ?? new Topic(this, 'AlarmTopic');

    // Lambda alarms
    const lambdaIds = new Set<string>();
    for (const fn of props.lambdaFunctions ?? []) {
      // Disambiguate handlers that share the same node.id (e.g. multiple Ingress/Handler constructs)
      let baseId = fn.node.id;
      if (lambdaIds.has(baseId)) {
        const parentId = fn.node.scope?.node.id ?? 'Unknown';
        baseId = `${parentId}${fn.node.id}`;
      }
      lambdaIds.add(baseId);

      // Errors > 0
      new Alarm(this, `${baseId}Errors`, {
        alarmDescription: `Lambda ${fn.node.id} errors > 0`,
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));

      // Duration > 80% of timeout (default 30s -> 24s)
      new Alarm(this, `${baseId}Duration`, {
        alarmDescription: `Lambda ${fn.node.id} duration > 80% timeout`,
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: 24_000, // 80% of 30s default
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));

      // Throttles > 0
      new Alarm(this, `${baseId}Throttles`, {
        alarmDescription: `Lambda ${fn.node.id} throttles > 0`,
        metric: fn.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    }

    // SQS DLQ alarms
    const dlqIds = new Set<string>();
    for (const dlq of props.dlqs ?? []) {
      // Use parent path to disambiguate DLQs with the same node.id (e.g. Ingress/DLQ vs Egress/DLQ)
      let alarmId = `${dlq.node.id}MessagesVisible`;
      if (dlqIds.has(alarmId)) {
        const parentId = dlq.node.scope?.node.id ?? 'Unknown';
        alarmId = `${parentId}${dlq.node.id}MessagesVisible`;
      }
      dlqIds.add(alarmId);
      new Alarm(this, alarmId, {
        alarmDescription: `DLQ ${dlq.node.id} has visible messages`,
        metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    }

    // EventBridge failed invocation alarms
    for (const busName of props.eventBusBusNames ?? []) {
      new Alarm(this, `${busName}FailedInvocations`, {
        alarmDescription: `EventBridge bus ${busName} failed invocations`,
        metric: new Metric({
          namespace: 'AWS/Events',
          metricName: 'FailedInvocations',
          dimensionsMap: { EventBusName: busName },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    }

    // Bedrock model invocation error alarms
    if (props.monitorBedrock) {
      for (const modelId of props.bedrockModelIds ?? []) {
        // Use a safe alarm id derived from the model ID
        const safeId = modelId.replace(/[^a-zA-Z0-9]/g, '');
        new Alarm(this, `Bedrock${safeId}Errors`, {
          alarmDescription: `Bedrock model ${modelId} invocation errors`,
          metric: new Metric({
            namespace: 'AWS/Bedrock',
            metricName: 'InvocationClientErrors',
            dimensionsMap: { ModelId: modelId },
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        }).addAlarmAction(new SnsAction(this.alarmTopic));
      }
    }

    // Step Functions alarms
    if (props.stepFunctions) {
      const sfMetric = (metricName: string) =>
        new Metric({
          namespace: 'AWS/States',
          metricName,
          dimensionsMap: { StateMachineArn: props.stepFunctions!.stateMachineArn },
          statistic: 'Sum',
          period: Duration.minutes(5),
        });

      new Alarm(this, 'SfExecutionsFailedAlarm', {
        metric: sfMetric('ExecutionsFailed'),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `Step Functions executions failed for ${props.stepFunctions.stateMachineName}`,
      }).addAlarmAction(new SnsAction(this.alarmTopic));

      new Alarm(this, 'SfExecutionsTimedOutAlarm', {
        metric: sfMetric('ExecutionsTimedOut'),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `Step Functions executions timed out for ${props.stepFunctions.stateMachineName}`,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    }
  }
}
