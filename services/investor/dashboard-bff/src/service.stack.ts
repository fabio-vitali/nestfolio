import { join } from 'path';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Facade, Broadcaster, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export class DashboardBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const facade = new Facade(this, 'Facade', {
      state,
      enableIamAuth: true,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDashboardUpdate', 'publishActivityUpdate', 'publishPositionUpdate'],
      }),
    });

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        InvestorIngestEventTypes.BALANCE_UPDATED,
        InvestorIngestEventTypes.PORTFOLIO_UPDATED,
        InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
        InvestorIngestEventTypes.DECISION_PACKET_CREATED,
        InvestorIngestEventTypes.DECISION_APPROVED,
        InvestorIngestEventTypes.DECISION_BLOCKED,
        InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
        InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
        InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
        InvestorIngestEventTypes.WITHDRAWAL_SETTLED,
        // AdvisoryStatus is now projected from advisory-bff's authoritative
        // announcement (forwarded advisory→investor by investor-adpt, Task 4.1)
        // instead of accumulated from disparate trigger events.
        InvestorIngestEventTypes.ADVISORY_STATUS_UPDATED,
        // DecisionPacket row CDC (forwarded advisory→investor by investor-adpt):
        // awaiting-confirmation activity projection on status=AWAITING_CONFIRMATION.
        InvestorIngestEventTypes.DECISION_PACKET_UPDATED,
      ],
    });

    // DDB-stream-driven broadcaster: fans read-model row mutations out to
    // clients via @aws_subscribe(mutations: ["publishDashboardUpdate"]). Keeps
    // the materialize pipeline declarative; subscription publication is a
    // post-commit side effect, no race with the engine's write. The construct
    // owns the publisher Lambda's DLQ + bisectBatchOnError + AppSync IAM grant.
    const broadcaster = new Broadcaster(this, 'DashboardBroadcaster', {
      state,
      entry: join(__dirname, 'handlers', 'dashboard-publisher.ts'),
      facade,
    });

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });

    this.addObservability({ ingress, broadcasters: [broadcaster] });
  }
}
