import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import {
  Dashboard,
  GraphWidget,
  SingleValueWidget,
  Metric,
  Row,
} from 'aws-cdk-lib/aws-cloudwatch';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';

export interface ServiceDashboardProps {
  /** Dashboard name suffix (e.g. 'investor-bff'). Full name: Nestfolio-{serviceName} */
  serviceName: string;
  /** Lambda functions to display metrics for */
  lambdaFunctions: IFunction[];
  /** SQS DLQs to display message counts for */
  dlqs?: IQueue[];
  /** EventBridge bus names to show failed invocations for */
  eventBusNames?: string[];
}

/**
 * Creates a CloudWatch dashboard for a service with Lambda, DLQ, and EventBridge widgets.
 */
export class ServiceDashboard extends Construct {
  readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: ServiceDashboardProps) {
    super(scope, id);

    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `Nestfolio-${props.serviceName}`,
    });

    const period = Duration.minutes(5);

    // Lambda invocations + errors row
    const invocationMetrics = props.lambdaFunctions.map((fn) =>
      fn.metricInvocations({ period }),
    );
    const errorMetrics = props.lambdaFunctions.map((fn) =>
      fn.metricErrors({ period }),
    );
    const durationMetrics = props.lambdaFunctions.map((fn) =>
      fn.metricDuration({ period, statistic: 'Average' }),
    );

    this.dashboard.addWidgets(
      new Row(
        new GraphWidget({
          title: 'Lambda Invocations',
          left: invocationMetrics,
          width: 8,
        }),
        new GraphWidget({
          title: 'Lambda Errors',
          left: errorMetrics,
          width: 8,
        }),
        new GraphWidget({
          title: 'Lambda Duration (avg ms)',
          left: durationMetrics,
          width: 8,
        }),
      ),
    );

    // Custom metrics row (EventProcessed / EventFailed from Nestfolio namespace)
    this.dashboard.addWidgets(
      new Row(
        new GraphWidget({
          title: 'Events Processed',
          left: [
            new Metric({
              namespace: 'Nestfolio',
              metricName: 'EventProcessed',
              dimensionsMap: { Service: props.serviceName },
              statistic: 'Sum',
              period,
            }),
          ],
          width: 12,
        }),
        new GraphWidget({
          title: 'Events Failed',
          left: [
            new Metric({
              namespace: 'Nestfolio',
              metricName: 'EventFailed',
              dimensionsMap: { Service: props.serviceName },
              statistic: 'Sum',
              period,
            }),
          ],
          width: 12,
        }),
      ),
    );

    // DLQ widgets
    if (props.dlqs && props.dlqs.length > 0) {
      this.dashboard.addWidgets(
        new Row(
          new SingleValueWidget({
            title: 'DLQ Messages',
            metrics: props.dlqs.map((dlq) =>
              dlq.metricApproximateNumberOfMessagesVisible({ period }),
            ),
            width: 12,
          }),
        ),
      );
    }

    // EventBridge widgets
    if (props.eventBusNames && props.eventBusNames.length > 0) {
      this.dashboard.addWidgets(
        new Row(
          new GraphWidget({
            title: 'EventBridge Failed Invocations',
            left: props.eventBusNames.map(
              (busName) =>
                new Metric({
                  namespace: 'AWS/Events',
                  metricName: 'FailedInvocations',
                  dimensionsMap: { EventBusName: busName },
                  statistic: 'Sum',
                  period,
                }),
            ),
            width: 12,
          }),
        ),
      );
    }
  }
}
