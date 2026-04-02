import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerIngestEventTypes } from './domain/events';

export class LedgerAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Consumer's own domain bus (target for all ingested events)
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // External source bus
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Ingest: Execution → Ledger
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'LedgerIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          LedgerIngestEventTypes.ORDER_FILLED,
          LedgerIngestEventTypes.ORDER_PARTIALLY_FILLED,
          LedgerIngestEventTypes.ORDER_REJECTED,
          LedgerIngestEventTypes.ORDER_CANCELLED,
          LedgerIngestEventTypes.DEPOSIT_DETECTED,
          LedgerIngestEventTypes.WITHDRAWAL_COMPLETED,
          LedgerIngestEventTypes.TRANSFER_FAILED,
          LedgerIngestEventTypes.CORPORATE_ACTION_APPLIED,
          LedgerIngestEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
          LedgerIngestEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
          LedgerIngestEventTypes.DECISION_PACKET_CREATED,
        ],
      },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: fromExecutionDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromExecutionDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-adpt',
        lambdaFunctions: [],
        dlqs: [fromExecutionDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
