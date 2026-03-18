import { EventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, Ingress, Egress, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';

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
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    this.addObservability({ ingress, egress });
  }
}
