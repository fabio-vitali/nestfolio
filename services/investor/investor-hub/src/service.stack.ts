import { Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { CostControls, SharedParameter, CrossAccountBusPolicy, getDomainAccounts, getConsumerAccountIds } from '@nestfolio/cdk-constructs/extensions';

export class InvestorHubStack extends ServiceStack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const domainAccounts = getDomainAccounts(this);
    const consumerAccountIds = getConsumerAccountIds(this, domainAccounts);

    // Domain bus
    this.bus = new EventBus(this, 'InvestorBus', {
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
      description: 'Investor event hub bus ARN',
      consumerAccountIds,
    });

    // Allow cross-account PutEvents when multi-account
    if (consumerAccountIds.length > 0) {
      new CrossAccountBusPolicy(this, 'CrossAccountPolicy', {
        eventBus: this.bus,
        consumerAccountIds,
      });
    }

    // Cost controls (deployed in Phase 1 as part of investor-hub).
    // dailyBudgetUsd + spikeRatio added 2026-04-28 after the 2026-04-21
    // $55.80 spike that sat below the old monthly-only thresholds.
    // alertTopicSsmExportPath lets per-service BedrockUsageAlarms reuse
    // the same SNS topic without cross-stack CFN refs.
    const alertEmail = this.node.tryGetContext('alertEmail') ?? 'alerts@nestfolio.dev';
    new CostControls(this, 'CostControls', {
      alertEmail,
      monthlyBudgetUsd: 200,
      dailyBudgetUsd: 30,
      spikeRatio: 0.075,
      alertTopicSsmExportPath: this.naming.ssmParameterPath('cost-controls/alertTopicArn'),
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
