import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { AdvisoryIngestEventTypes } from './domain/events';

export class AdvisoryAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // External source buses
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingest: Investor → Advisory
    const fromInvestorDlq = new Queue(this, 'FromInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.GOAL_CREATED,
          AdvisoryIngestEventTypes.GOAL_UPDATED,
          AdvisoryIngestEventTypes.RISK_PROFILE_CREATED,
          AdvisoryIngestEventTypes.RISK_PROFILE_UPDATED,
          AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
          AdvisoryIngestEventTypes.MANDATE_CREATED,
          AdvisoryIngestEventTypes.MANDATE_UPDATED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromInvestorDlq })],
    });

    // Ingest: Execution → Advisory
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.ORDER_FILLED,
          AdvisoryIngestEventTypes.ORDER_REJECTED,
          AdvisoryIngestEventTypes.ORDER_CANCELLED,
          AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromExecutionDlq })],
    });

    // Ingest: Ledger → Advisory
    const fromLedgerDlq = new Queue(this, 'FromLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'AdvisoryIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          AdvisoryIngestEventTypes.PORTFOLIO_UPDATED,
          AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromLedgerDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromInvestorDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-adpt',
        lambdaFunctions: [],
        dlqs: [fromInvestorDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
