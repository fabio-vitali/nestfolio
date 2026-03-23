import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';

export class ExecutionCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['DECISION_APPROVED', 'USER_CONFIRMED', 'CIRCUIT_BREAKER_TRIGGERED', 'CIRCUIT_BREAKER_RESET', 'ACCOUNT_CLOSURE_REQUESTED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Order', 'StagedOrder'],
    });

    // Staged-order processor: runs at US market open (9:30 AM ET = 14:30 UTC, weekdays)
    const stagedOrderProcessor = new NodejsFunction(this, 'StagedOrderProcessor', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'staged-order-processor.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      environment: {
        TABLE_NAME: this.state.getTable().tableName,
        SERVICE_NAME: 'execution-ctrl',
      },
    });

    this.state.getTable().grantReadWriteData(stagedOrderProcessor);

    new AdapterSchedule(this, 'MarketOpenSchedule', {
      target: stagedOrderProcessor,
      scheduleExpression: 'cron(30 14 ? * MON-FRI *)',
      enabled: true,
      maxRetryAttempts: 2,
      flexibleWindowMinutes: 5,
    });

    this.addObservability({ ingress, egress, extraLambdas: [stagedOrderProcessor] });
  }
}
