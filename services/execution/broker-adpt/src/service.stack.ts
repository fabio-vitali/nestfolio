import { join } from 'path';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class BrokerAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['ORDER_SUBMITTED', 'WITHDRAWAL_REQUESTED', 'DEPOSIT_INITIATED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition'],
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    this.addObservability({ ingress, egress });
  }
}
