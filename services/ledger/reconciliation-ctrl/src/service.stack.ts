import { EventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';

export class ReconciliationCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const domainAccounts = getDomainAccounts(this);
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'PORTFOLIO_UPDATED',
        'PORTFOLIO_SNAPSHOT_IMPORTED',
        'CORPORATE_ACTION_APPLIED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['ReconciliationResult', 'DriftRecord'],
    });

    this.addObservability({ ingress, egress });
  }
}
