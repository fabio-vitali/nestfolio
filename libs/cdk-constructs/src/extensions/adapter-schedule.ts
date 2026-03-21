import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';

export interface AdapterScheduleProps {
  /** Lambda function to invoke on schedule */
  readonly target: IFunction;
  /** Schedule expression (e.g. 'rate(6 hours)', 'rate(24 hours)') */
  readonly scheduleExpression: string;
  /** Whether the schedule is enabled (false = DISABLED state, zero cost) */
  readonly enabled: boolean;
  /** Maximum retry attempts for failed invocations (default: 1) */
  readonly maxRetryAttempts?: number;
  /** Maximum event age before discarding (default: 1 hour) */
  readonly maxEventAge?: Duration;
  /** Flexible time window in minutes (default: 15) */
  readonly flexibleWindowMinutes?: number;
}

export class AdapterSchedule extends Construct {
  readonly schedule: CfnSchedule;

  constructor(scope: Construct, id: string, props: AdapterScheduleProps) {
    super(scope, id);

    const flexibleWindow = props.flexibleWindowMinutes ?? 15;
    const maxRetry = props.maxRetryAttempts ?? 1;
    const maxAge = props.maxEventAge ?? Duration.hours(1);

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });

    schedulerRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [props.target.functionArn],
    }));

    this.schedule = new CfnSchedule(this, 'Schedule', {
      scheduleExpression: props.scheduleExpression,
      scheduleExpressionTimezone: 'UTC',
      state: props.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: {
        mode: 'FLEXIBLE',
        maximumWindowInMinutes: flexibleWindow,
      },
      target: {
        arn: props.target.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: {
          maximumRetryAttempts: maxRetry,
          maximumEventAgeInSeconds: maxAge.toSeconds(),
        },
      },
    });
  }
}
