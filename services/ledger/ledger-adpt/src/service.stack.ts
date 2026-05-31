import { Duration } from 'aws-cdk-lib';
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
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
    const serviceName = 'ledger-adpt';

    // Consumer's own domain bus (target for all ingested events)
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // External source buses
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Ingest: Execution → Ledger
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromExecutionEvents = [
      LedgerIngestEventTypes.ORDER_FILLED,
      LedgerIngestEventTypes.ORDER_PARTIALLY_FILLED,
      LedgerIngestEventTypes.ORDER_REJECTED,
      LedgerIngestEventTypes.ORDER_CANCELLED,
      LedgerIngestEventTypes.DEPOSIT_SETTLED,
      LedgerIngestEventTypes.WITHDRAWAL_SETTLED,
      LedgerIngestEventTypes.CORPORATE_ACTION_APPLIED,
      LedgerIngestEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
      LedgerIngestEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
    ];
    const fromExecutionRule = new Rule(this, 'LedgerIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Advisory → Ledger
    const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromAdvisoryEvents = [
      LedgerIngestEventTypes.DECISION_PACKET_CREATED,
    ];
    const fromAdvisoryRule = new Rule(this, 'LedgerIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: { detailType: fromAdvisoryEvents },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: fromAdvisoryDlq })],
    });
    (fromAdvisoryRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromExecutionDlq, fromAdvisoryDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-adpt',
        lambdaFunctions: [],
        dlqs: [fromExecutionDlq, fromAdvisoryDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
