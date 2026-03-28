import { Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { SharedParameter, CrossAccountBusPolicy, getDomainAccounts, getConsumerAccountIds } from '@nestfolio/cdk-constructs/extensions';

export class ExecutionHubStack extends ServiceStack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const domainAccounts = getDomainAccounts(this);
    const consumerAccountIds = getConsumerAccountIds(this, domainAccounts);

    // Domain bus
    this.bus = new EventBus(this, 'ExecutionBus', {
      eventBusName: this.naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${this.naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM (Advanced tier + RAM share when cross-account)
    new SharedParameter(this, 'BusArnParam', {
      parameterName: this.naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Execution event hub bus ARN',
      consumerAccountIds,
    });

    // Allow cross-account PutEvents when multi-account
    if (consumerAccountIds.length > 0) {
      new CrossAccountBusPolicy(this, 'CrossAccountPolicy', {
        eventBus: this.bus,
        consumerAccountIds,
      });
    }

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'execution-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
