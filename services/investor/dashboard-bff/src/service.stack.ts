import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export class DashboardBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        InvestorIngestEventTypes.BALANCE_UPDATED,
        InvestorIngestEventTypes.PORTFOLIO_UPDATED,
        InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
        InvestorIngestEventTypes.DECISION_PACKET_CREATED,
        InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
        InvestorIngestEventTypes.DECISION_APPROVED,
        InvestorIngestEventTypes.DECISION_BLOCKED,
        InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
        InvestorBffEventTypes.GOAL_CREATED,
        InvestorBffEventTypes.GOAL_UPDATED,
        InvestorBffEventTypes.RISK_PROFILE_CREATED,
        InvestorBffEventTypes.RISK_PROFILE_UPDATED,
        InvestorBffEventTypes.OPERATING_MODE_SELECTED,
        InvestorBffEventTypes.OPERATING_MODE_CHANGED,
      ],
    });

    new Facade(this, 'Facade', {
      state,
      jsResolvers: discoverJsResolvers(__dirname),
    });

    this.addObservability({ ingress });
  }
}
