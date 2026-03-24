import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';

export class DashboardBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'RECONCILIATION_COMPLETED',
        'DECISION_PACKET_CREATED',
        'USER_CONFIRMATION_REQUESTED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'LEDGER_ENTRY_RECORDED',
        'GOAL_SET',
        'GOAL_UPDATED',
        'RISK_PROFILE_SET',
        'RISK_PROFILE_UPDATED',
        'OPERATING_MODE_SELECTED',
        'OPERATING_MODE_CHANGED',
      ],
    });

    new Facade(this, 'Facade', {
      jsResolvers: discoverJsResolvers(__dirname),
    });

    this.addObservability({ ingress });
  }
}
