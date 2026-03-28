import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { BrokerSimEventTypes } from './domain/events';

export class BrokerSimAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        BrokerSimEventTypes.SIM_ORDER_REQUESTED,
        BrokerSimEventTypes.SIM_DEPOSIT_INITIATED,
        BrokerSimEventTypes.SIM_WITHDRAWAL_REQUESTED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      publishableTypes: ['VirtualTrade', 'DepositDetected', 'WithdrawalCompleted'],
    });

    this.addObservability({ ingress, egress });
  }
}
