import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface CostControlsProps {
  alertEmail: string;
  monthlyBudgetUsd: number; // e.g. 200
  /**
   * Daily AWS Budget alarm in USD. Catches sudden burns that sit below the
   * monthly threshold but blow past a sustainable per-day rate (the
   * 2026-04-21 $55.80 day was silent under the old 6h spike alarm).
   * Default $30 — sustainable rate for the dev account given current
   * 33-service deploy.
   */
  dailyBudgetUsd?: number;
  /**
   * Fraction of the monthly budget that defines the rolling 6h spike
   * alarm threshold. Default 0.075 → ~$15 / 6h on a $200/mo budget,
   * which would have caught the 2026-04-21 spike. Tighten/loosen here
   * without editing the construct.
   */
  spikeRatio?: number;
  /**
   * If set, exports the SNS alert topic ARN to SSM at this path so other
   * service stacks (e.g. BedrockUsageAlarms) can reuse it without
   * cross-stack CFN refs. Path is the *full* SSM parameter name.
   */
  alertTopicSsmExportPath?: string;
}

export class CostControls extends Construct {
  readonly alertTopic: Topic;

  constructor(scope: Construct, id: string, props: CostControlsProps) {
    super(scope, id);

    const dailyBudgetUsd = props.dailyBudgetUsd ?? 30;
    const spikeRatio = props.spikeRatio ?? 0.075;

    this.alertTopic = new Topic(this, 'CostAlertTopic');
    this.alertTopic.addSubscription(new EmailSubscription(props.alertEmail));

    if (props.alertTopicSsmExportPath) {
      new StringParameter(this, 'CostAlertTopicArnParam', {
        parameterName: props.alertTopicSsmExportPath,
        stringValue: this.alertTopic.topicArn,
        description: 'CostControls SNS topic ARN — reused by per-service Bedrock alarms',
      });
    }

    // Monthly budget — coarse, bills-cycle aligned
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'nestfolio-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
        },
      ],
    });

    // Daily budget — catches silent sub-monthly spikes (added post 2026-04-21 incident)
    new CfnBudget(this, 'DailyBudget', {
      budget: {
        budgetName: 'nestfolio-daily',
        budgetType: 'COST',
        timeUnit: 'DAILY',
        budgetLimit: { amount: dailyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.alertTopic.topicArn }],
        },
      ],
    });

    // Rolling 6h spike alarm — tightened from monthlyBudgetUsd*0.5 to ~7.5%
    // by default ($15/6h on a $200/mo budget). Catches the kind of burst
    // that was silent on 2026-04-21.
    new Alarm(this, 'BillingAlarm', {
      alarmName: 'nestfolio-billing-spike',
      metric: new Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: Duration.hours(6),
      }),
      threshold: props.monthlyBudgetUsd * spikeRatio,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new SnsAction(this.alertTopic));
  }
}
