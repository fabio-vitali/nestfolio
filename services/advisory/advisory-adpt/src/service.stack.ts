import { Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { AdvisoryCrossDomainEventTypes } from './domain/events';

export class AdvisoryAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props });

    const domainAccounts = getDomainAccounts(this);

    const advisoryBusArn = resolveBusArn(
      this,
      'AdvisoryBus',
      this.prefix,
      'advisory',
      domainAccounts,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const investorBusArn = resolveBusArn(
      this,
      'InvestorBus',
      this.prefix,
      'investor',
      domainAccounts,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const executionBusArn = resolveBusArn(
      this,
      'ExecutionBus',
      this.prefix,
      'execution',
      domainAccounts,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    new Rule(this, 'ToInvestor', {
      eventBus: advisoryBus,
      eventPattern: {
        detailType: [
          AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED,
          AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED,
          AdvisoryCrossDomainEventTypes.EXPLANATION_GENERATED,
          AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
          AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
          AdvisoryCrossDomainEventTypes.ESCALATION_TRIGGERED,
          AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED,
          AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET,
          AdvisoryCrossDomainEventTypes.INCIDENT_DETECTED,
          AdvisoryCrossDomainEventTypes.INCIDENT_RESOLVED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    const toExecutionDlq = new Queue(this, 'ToExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    new Rule(this, 'ToExecution', {
      eventBus: advisoryBus,
      eventPattern: {
        detailType: [
          AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
          AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED,
          AdvisoryCrossDomainEventTypes.USER_CONFIRMED,
          AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED,
          AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET,
        ],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toExecutionDlq],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-adpt',
        lambdaFunctions: [],
        dlqs: [toInvestorDlq, toExecutionDlq],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
