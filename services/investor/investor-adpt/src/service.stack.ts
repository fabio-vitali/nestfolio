import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { InvestorCrossDomainEventTypes } from './domain/events';

export class InvestorAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, stateProps: false });

    const prefix = this.prefix;
    const domainAccounts = getDomainAccounts(this);

    // Resolve investor domain bus
    const investorBusArn = resolveBusArn(this, 'InvestorBus', prefix, 'investor', domainAccounts);
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // Resolve target buses
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const executionBusArn = resolveBusArn(this, 'ExecutionBus', prefix, 'execution', domainAccounts);
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Cross-domain forwarding: Investor → Advisory
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          InvestorCrossDomainEventTypes.GOAL_UPDATED,
          InvestorCrossDomainEventTypes.RISK_PROFILE_UPDATED,
          InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED,
          InvestorCrossDomainEventTypes.MANDATE_GRANTED,
          InvestorCrossDomainEventTypes.MANDATE_UPDATED,
          InvestorCrossDomainEventTypes.MANDATE_REVOKED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    // Cross-domain forwarding: Investor → Execution
    const toExecutionDlq = new Queue(this, 'ToExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToExecution', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          InvestorCrossDomainEventTypes.DEPOSIT_INITIATED,
          InvestorCrossDomainEventTypes.WITHDRAWAL_REQUESTED,
          InvestorCrossDomainEventTypes.ACCOUNT_CLOSURE_REQUESTED,
        ],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toAdvisoryDlq, toExecutionDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-adpt',
        lambdaFunctions: [],
        dlqs: [toAdvisoryDlq, toExecutionDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
