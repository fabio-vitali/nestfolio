import { Duration } from 'aws-cdk-lib';
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { ExecutionIngestEventTypes } from './domain/events';

export class ExecutionAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);
    const serviceName = 'execution-adpt';

    // Consumer's own domain bus (target for all ingested events)
    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // External source buses
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // Ingest: Advisory → Execution
    const fromAdvisoryDlq = new Queue(this, 'FromAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromAdvisoryEvents = [
      ExecutionIngestEventTypes.DECISION_APPROVED,
      ExecutionIngestEventTypes.USER_CONFIRMED,
      ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
      ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET,
    ];
    const fromAdvisoryRule = new Rule(this, 'ExecutionIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: { detailType: fromAdvisoryEvents },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromAdvisoryDlq })],
    });
    (fromAdvisoryRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    // Ingest: Investor → Execution
    const fromInvestorDlq = new Queue(this, 'FromInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    const fromInvestorEvents = [
      ExecutionIngestEventTypes.DEPOSIT_INITIATED,
      ExecutionIngestEventTypes.WITHDRAWAL_REQUESTED,
      ExecutionIngestEventTypes.ACCOUNT_CLOSURE_REQUESTED,
      ExecutionIngestEventTypes.EXECUTION_MODE_CHANGED,
    ];
    const fromInvestorRule = new Rule(this, 'ExecutionIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: { detailType: fromInvestorEvents },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromInvestorDlq })],
    });
    (fromInvestorRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromInvestorEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromInvestorEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [fromAdvisoryDlq, fromInvestorDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'execution-adpt',
        lambdaFunctions: [],
        dlqs: [fromAdvisoryDlq, fromInvestorDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
