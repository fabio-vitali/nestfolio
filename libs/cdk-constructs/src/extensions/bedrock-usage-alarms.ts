import { Construct } from 'constructs';
import { Duration, Token } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface BedrockUsageAlarmsProps {
  /**
   * Per-service identifier used in alarm names. Typically the Nx project
   * name (e.g. "onboarding-bff", "advisory-ctrl").
   */
  serviceName: string;
  /**
   * Bedrock inference-profile / model ids this service might invoke.
   * One alarm set (Invocations + Input + Output) is created per id so
   * a runaway on any model is detected. Pass the same strings the
   * service actually invokes (inference-profile ids like
   * `us.anthropic.claude-sonnet-4-6` are fine — CloudWatch reports
   * whatever the SDK uses).
   */
  modelIds: string[];
  /**
   * SNS topic that receives the alarm action. Pass either the topic
   * directly (same-stack) or import via SSM
   * (StringParameter.valueForStringParameter + Topic.fromTopicArn).
   */
  alertTopic: ITopic;
  /**
   * Invocation-rate threshold over a 5-minute window. Default 100.
   * A real wave of work will breach this; runaway agents hammering the
   * model in a tool-call loop breach it within a single window.
   */
  invocationsPer5MinThreshold?: number;
  /**
   * Aggregate input-token threshold over a 5-minute window. Default 500K.
   * Cap per invocation is 2K (P0 caps), so 500K ≈ 250 invocations of
   * full-cap prompts — well above legitimate per-window load.
   */
  inputTokensPer5MinThreshold?: number;
  /**
   * Aggregate output-token threshold over a 5-minute window. Default 100K.
   * Cap per invocation is 2K (P0 caps), so 100K ≈ 50 invocations at full
   * output — same envelope.
   */
  outputTokensPer5MinThreshold?: number;
}

/**
 * Per-service CloudWatch alarms on the AWS/Bedrock namespace, dimensioned
 * by ModelId. Surfaces the kind of spike that 2026-04-21 went undetected
 * for an entire day under the monthly-budget-only setup.
 */
export class BedrockUsageAlarms extends Construct {
  constructor(scope: Construct, id: string, props: BedrockUsageAlarmsProps) {
    super(scope, id);

    const invocationsThreshold = props.invocationsPer5MinThreshold ?? 100;
    const inputTokensThreshold = props.inputTokensPer5MinThreshold ?? 500_000;
    const outputTokensThreshold = props.outputTokensPer5MinThreshold ?? 100_000;

    if (props.modelIds.length === 0) {
      throw new Error('BedrockUsageAlarms requires at least one modelId.');
    }

    const action = new SnsAction(props.alertTopic);

    props.modelIds.forEach((modelId, idx) => {
      // Per-model alarms — runaway on any candidate model is caught.
      // Suffix prefers a friendly tier slug (`-haiku`/`-sonnet`/`-opus`)
      // when the literal model id is known at synth time. When the id
      // arrives as a CloudFormation token (e.g. `valueForStringParameter`
      // from SSM), the slug match fails — fall back to the array index.
      const suffix = props.modelIds.length === 1
        ? ''
        : `-${Token.isUnresolved(modelId) ? idx : slugifyModelId(modelId)}`;

      new Alarm(this, `InvocationsAlarm${idx}`, {
        alarmName: `${props.serviceName}-bedrock-invocations${suffix}`,
        metric: new Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'Invocations',
          dimensionsMap: { ModelId: modelId },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: invocationsThreshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);

      new Alarm(this, `InputTokensAlarm${idx}`, {
        alarmName: `${props.serviceName}-bedrock-input-tokens${suffix}`,
        metric: new Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'InputTokenCount',
          dimensionsMap: { ModelId: modelId },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: inputTokensThreshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);

      new Alarm(this, `OutputTokensAlarm${idx}`, {
        alarmName: `${props.serviceName}-bedrock-output-tokens${suffix}`,
        metric: new Metric({
          namespace: 'AWS/Bedrock',
          metricName: 'OutputTokenCount',
          dimensionsMap: { ModelId: modelId },
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: outputTokensThreshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(action);
    });
  }
}

/**
 * Compress an inference-profile id (e.g. `us.anthropic.claude-sonnet-4-6`)
 * into something safe for a CloudWatch alarm name.
 */
function slugifyModelId(id: string): string {
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('opus')) return 'opus';
  return id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32);
}

/**
 * Convenience: import the SNS topic that CostControls exported via SSM,
 * so per-service stacks can wire BedrockUsageAlarms without cross-stack
 * CFN refs.
 */
export function importCostAlertTopic(
  scope: Construct,
  id: string,
  ssmParameterName: string,
): ITopic {
  const arn = StringParameter.valueForStringParameter(scope, ssmParameterName);
  return Topic.fromTopicArn(scope, id, arn);
}
