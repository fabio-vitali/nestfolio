import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';

export class LedgerHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-hub',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'ledger-hub', domain: 'ledger', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'LedgerBus', {
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
      description: 'Ledger event hub bus ARN',
    });

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
