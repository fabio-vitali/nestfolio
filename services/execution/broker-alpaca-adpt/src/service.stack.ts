import { Construct } from 'constructs';
import { Egress, Ingress, ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { AlpacaAdptEventTypes } from './domain/events';

export class BrokerAlpacaAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['AlpacaOrderResult', 'AlpacaTransferResult', 'AlpacaAccountSnapshot'],
    });

    this.addObservability({ ingress, egress });
  }
}
