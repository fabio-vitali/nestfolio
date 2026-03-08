import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic, ITopic } from 'aws-cdk-lib/aws-sns';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';

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
    for (const fn of props.lambdaFunctions ?? []) {
      // Errors > 0
      new Alarm(this, `${fn.node.id}Errors`, {
        alarmDescription: `Lambda ${fn.node.id} errors > 0`,
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));

      // Duration > 80% of timeout (default 30s -> 24s)
      new Alarm(this, `${fn.node.id}Duration`, {
        alarmDescription: `Lambda ${fn.node.id} duration > 80% timeout`,
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: 24_000, // 80% of 30s default
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));

      // Throttles > 0
      new Alarm(this, `${fn.node.id}Throttles`, {
        alarmDescription: `Lambda ${fn.node.id} throttles > 0`,
        metric: fn.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(this.alarmTopic));
    }

    // SQS DLQ alarms
    for (const dlq of props.dlqs ?? []) {
      new Alarm(this, `${dlq.node.id}MessagesVisible`, {
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
  }
}
