import { Construct } from 'constructs';
import { Egress, Ingress, ServiceStack, ServiceStackProps, State } from '@nestfolio/cdk-constructs/core';
import { AlpacaAdptEventTypes } from './domain/events';

export class BrokerAlpacaAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AlpacaOrderResult': {
          insert: { field: 'status', map: {
            PLACED: 'ALPACA_ORDER_PLACED',
            FILLED: 'ALPACA_ORDER_FILLED',
            PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
            REJECTED: 'ALPACA_ORDER_REJECTED',
            CANCELLED: 'ALPACA_ORDER_CANCELLED',
            CANCEL_FAILED: 'ALPACA_ORDER_CANCEL_FAILED',
          }},
          modify: { field: 'status', map: {
            FILLED: 'ALPACA_ORDER_FILLED',
            PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
            REJECTED: 'ALPACA_ORDER_REJECTED',
            CANCELLED: 'ALPACA_ORDER_CANCELLED',
          }},
        },
        'AlpacaTransferResult': {
          insert: { field: 'status', map: {
            INITIATED: 'ALPACA_TRANSFER_INITIATED',
            COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
            FAILED: 'ALPACA_TRANSFER_FAILED',
          }},
          modify: { field: 'status', map: {
            COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
            FAILED: 'ALPACA_TRANSFER_FAILED',
          }},
        },
        'AlpacaAccountSnapshot': { insert: 'ALPACA_ACCOUNT_SNAPSHOT' },
      },
    });

    this.addObservability({ ingress, egress });
  }
}
