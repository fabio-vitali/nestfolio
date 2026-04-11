import { Duration } from 'aws-cdk-lib';
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { InvestorIngestEventTypes } from './domain/events';

export class InvestorAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);
    const serviceName = 'investor-adpt';

    // Consumer's own domain bus (target for all ingested events)
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // External source buses
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', prefix, 'ledger', domainAccounts);
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingest: Advisory → Investor
    const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromAdvisoryEvents = [
      InvestorIngestEventTypes.DECISION_PACKET_CREATED,
      InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
      InvestorIngestEventTypes.EXPLANATION_GENERATED,
      InvestorIngestEventTypes.DECISION_APPROVED,
      InvestorIngestEventTypes.DECISION_BLOCKED,
      InvestorIngestEventTypes.ESCALATION_TRIGGERED,
      InvestorIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
      InvestorIngestEventTypes.CIRCUIT_BREAKER_RESET,
      InvestorIngestEventTypes.INCIDENT_DETECTED,
      InvestorIngestEventTypes.INCIDENT_RESOLVED,
    ];
    const fromAdvisoryRule = new Rule(this, 'InvestorIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: { detailType: fromAdvisoryEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromAdvisoryDlq })],
    });
    (fromAdvisoryRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Execution → Investor
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromExecutionEvents = [
      InvestorIngestEventTypes.ORDER_STAGED,
      InvestorIngestEventTypes.ORDER_FILLED,
      InvestorIngestEventTypes.ORDER_REJECTED,
      InvestorIngestEventTypes.ORDER_CANCELLED,
      InvestorIngestEventTypes.DEPOSIT_DETECTED,
      InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
      InvestorIngestEventTypes.ORDER_ESCALATED,
      InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN,
      InvestorIngestEventTypes.TRANSFER_FAILED,
    ];
    const fromExecutionRule = new Rule(this, 'InvestorIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Ledger → Investor
    const fromLedgerDlq = new Queue(this, 'FromLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromLedgerEvents = [
      InvestorIngestEventTypes.BALANCE_UPDATED,
      InvestorIngestEventTypes.PORTFOLIO_UPDATED,
      InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
      InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
      InvestorIngestEventTypes.LEDGER_PROCESSING_FAILED,
    ];
    const fromLedgerRule = new Rule(this, 'InvestorIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: { detailType: fromLedgerEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromLedgerDlq })],
    });
    (fromLedgerRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromLedgerEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromLedgerEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromAdvisoryDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-adpt',
        lambdaFunctions: [],
        dlqs: [fromAdvisoryDlq, fromExecutionDlq, fromLedgerDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
