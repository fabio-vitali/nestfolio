import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { BrokerSimEventTypes } from './domain/events';

export class BrokerSimAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        BrokerSimEventTypes.SIM_ORDER_REQUESTED,
        BrokerSimEventTypes.SIM_DEPOSIT_INITIATED,
        BrokerSimEventTypes.SIM_WITHDRAWAL_REQUESTED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition', 'DepositDetected', 'WithdrawalCompleted'],
    });

    this.addObservability({ ingress, egress });
  }
}
