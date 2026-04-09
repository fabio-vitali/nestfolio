import { EventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { ReconciliationEventTypes } from './domain/events';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';

export class ReconciliationCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const domainAccounts = getDomainAccounts(this);
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
        ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
        ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
        ExecutionCrossDomainEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'ReconciliationResult': {
          insert: ReconciliationEventTypes.RECONCILIATION_COMPLETED,
          modify: ReconciliationEventTypes.RECONCILIATION_RESULT_UPDATED,
        },
        'DriftRecord': {
          insert: ReconciliationEventTypes.PORTFOLIO_DRIFT_DETECTED,
          modify: ReconciliationEventTypes.DRIFT_RECORD_UPDATED,
        },
      },
    });

    this.addObservability({ ingress, egress });
  }
}
