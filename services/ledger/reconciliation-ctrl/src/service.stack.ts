import { EventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';

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
        'PORTFOLIO_UPDATED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
        'ALPACA_ACCOUNT_SNAPSHOT',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'ReconciliationResult': { insert: 'RECONCILIATION_COMPLETED', modify: 'RECONCILIATION_RESULT_UPDATED' },
        'DriftRecord': { insert: 'PORTFOLIO_DRIFT_DETECTED', modify: 'DRIFT_RECORD_UPDATED' },
      },
    });

    this.addObservability({ ingress, egress });
  }
}
