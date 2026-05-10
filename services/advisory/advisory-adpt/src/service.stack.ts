import { Duration } from 'aws-cdk-lib';
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
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
    const serviceName = 'advisory-adpt';

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
    // INVESTOR_PROFILE_CREATED removed 2026-05-10 — zero advisoryBus consumers
    // post-migration to ADVISORY_PIPELINE_READY-driven first decision.
    const fromInvestorEvents = [
      AdvisoryIngestEventTypes.INVESTOR_PROFILE_UPDATED,
      AdvisoryIngestEventTypes.MANDATE_ISSUED,
      AdvisoryIngestEventTypes.MANDATE_REVOKED,
      AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
    ];
    const fromInvestorRule = new Rule(this, 'AdvisoryIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: { detailType: fromInvestorEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromInvestorDlq })],
    });
    (fromInvestorRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromInvestorEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromInvestorEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Execution → Advisory
    const fromExecutionDlq = new Queue(this, 'FromExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromExecutionEvents = [
      AdvisoryIngestEventTypes.ORDER_FILLED,
      AdvisoryIngestEventTypes.ORDER_REJECTED,
      AdvisoryIngestEventTypes.ORDER_CANCELLED,
      AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
    ];
    const fromExecutionRule = new Rule(this, 'AdvisoryIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Ledger → Advisory
    const fromLedgerDlq = new Queue(this, 'FromLedgerDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromLedgerEvents = [
      AdvisoryIngestEventTypes.PORTFOLIO_UPDATED,
      AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
    ];
    const fromLedgerRule = new Rule(this, 'AdvisoryIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: { detailType: fromLedgerEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromLedgerDlq })],
    });
    (fromLedgerRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromLedgerEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromLedgerEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
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
