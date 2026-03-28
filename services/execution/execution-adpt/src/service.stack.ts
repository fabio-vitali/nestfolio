import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { ExecutionCrossDomainEventTypes } from './domain/events';

export class ExecutionAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Resolve execution domain bus
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Resolve target buses
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Cross-domain forwarding: Execution → Investor
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToInvestor', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          ExecutionCrossDomainEventTypes.ORDER_STAGED,
          ExecutionCrossDomainEventTypes.ORDER_REJECTED,
          ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
          ExecutionCrossDomainEventTypes.WITHDRAWAL_REJECTED,
          ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
          ExecutionCrossDomainEventTypes.ORDER_ESCALATED,
          ExecutionCrossDomainEventTypes.BROKER_CIRCUIT_OPEN,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Execution → Ledger
    const toLedgerDlq = new Queue(this, 'ToLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToLedger', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          ExecutionCrossDomainEventTypes.ORDER_FILLED,
          ExecutionCrossDomainEventTypes.ORDER_PARTIALLY_FILLED,
          ExecutionCrossDomainEventTypes.ORDER_REJECTED,
          ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
          ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED,
          ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
          ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
          ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
          ExecutionCrossDomainEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
        ],
      },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: toLedgerDlq })],
    });

    // Cross-domain forwarding: Execution → Advisory
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          ExecutionCrossDomainEventTypes.ORDER_FILLED,
          ExecutionCrossDomainEventTypes.ORDER_REJECTED,
          ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
          ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED,
          ExecutionCrossDomainEventTypes.PORTFOLIO_DRIFT_DETECTED,
          ExecutionCrossDomainEventTypes.BROKER_SESSION_LOST,
          ExecutionCrossDomainEventTypes.STREAM_DISCONNECTED,
          ExecutionCrossDomainEventTypes.RECONCILIATION_FAILED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toLedgerDlq, toAdvisoryDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'execution-adpt',
        lambdaFunctions: [],
        dlqs: [toInvestorDlq, toLedgerDlq, toAdvisoryDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
