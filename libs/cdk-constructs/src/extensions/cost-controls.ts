import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Alarm, ComparisonOperator, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

export interface CostControlsProps {
  alertEmail: string;
  monthlyBudgetUsd: number; // e.g. 200
}

export class CostControls extends Construct {
  constructor(scope: Construct, id: string, props: CostControlsProps) {
    super(scope, id);

    const alertTopic = new Topic(this, 'CostAlertTopic');
    alertTopic.addSubscription(new EmailSubscription(props.alertEmail));

    // AWS Budget with 80% and 100% thresholds
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
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
      ],
    });

    // CloudWatch billing alarm (catches sudden cost spikes)
    new Alarm(this, 'BillingAlarm', {
      alarmName: 'nestfolio-billing-spike',
      metric: new Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        dimensionsMap: { Currency: 'USD' },
        statistic: 'Maximum',
        period: Duration.hours(6),
      }),
      threshold: props.monthlyBudgetUsd * 0.5, // Alert at 50% of monthly in a single 6h window
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(new SnsAction(alertTopic));
  }
}
