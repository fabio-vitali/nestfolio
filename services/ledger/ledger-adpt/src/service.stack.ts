import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerCrossDomainEventTypes } from './domain/events';

export class LedgerAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, stateProps: false });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Resolve ledger domain bus
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Resolve target buses
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Cross-domain forwarding: Ledger → Investor
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToInvestor', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          LedgerCrossDomainEventTypes.BALANCE_UPDATED,
          LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED,
          LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED,
          LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED,
          LedgerCrossDomainEventTypes.RECONCILIATION_FAILED,
          LedgerCrossDomainEventTypes.LEDGER_PROCESSING_FAILED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Ledger → Advisory
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED,
          LedgerCrossDomainEventTypes.PORTFOLIO_DRIFT_DETECTED,
          LedgerCrossDomainEventTypes.RECONCILIATION_FAILED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toAdvisoryDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-adpt',
        lambdaFunctions: [],
        dlqs: [toAdvisoryDlq, toAdvisoryDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
