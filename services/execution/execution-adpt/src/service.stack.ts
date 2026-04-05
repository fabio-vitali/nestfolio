import { Duration } from 'aws-cdk-lib';
import { EventBus, Match, Rule } from 'aws-cdk-lib/aws-events';
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
    new Rule(this, 'ExecutionIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: {
        detailType: [
          ExecutionIngestEventTypes.DECISION_APPROVED,
          ExecutionIngestEventTypes.DECISION_PACKET_CREATED,
          ExecutionIngestEventTypes.USER_CONFIRMED,
          ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
          ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET,
        ],
        source: Match.anyOf(
          Match.anythingButPrefix('integration-test:'),
          Match.prefix(`integration-test:${serviceName}`),
        ),
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromAdvisoryDlq })],
    });

    // Ingest: Investor → Execution
    const fromInvestorDlq = new Queue(this, 'FromInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ExecutionIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          ExecutionIngestEventTypes.DEPOSIT_INITIATED,
          ExecutionIngestEventTypes.WITHDRAWAL_REQUESTED,
          ExecutionIngestEventTypes.ACCOUNT_CLOSURE_REQUESTED,
          ExecutionIngestEventTypes.EXECUTION_MODE_CHANGED,
        ],
        source: Match.anyOf(
          Match.anythingButPrefix('integration-test:'),
          Match.prefix(`integration-test:${serviceName}`),
        ),
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromInvestorDlq })],
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
