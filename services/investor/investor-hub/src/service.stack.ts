import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, CostControls, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';

export class InvestorHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-hub',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'investor-hub', domain: 'investor', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'InvestorBus', {
      eventBusName: naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM for cross-domain discovery
    new StringParameter(this, 'BusArnParam', {
      parameterName: naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Investor event hub bus ARN',
    });

    // Cost controls (deployed in Phase 1 as part of investor-hub)
    const alertEmail = this.node.tryGetContext('alertEmail') ?? 'alerts@nestfolio.dev';
    new CostControls(this, 'CostControls', {
      alertEmail,
      monthlyBudgetUsd: 200,
    });

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
