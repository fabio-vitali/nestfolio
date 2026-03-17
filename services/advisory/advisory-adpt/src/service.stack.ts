import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';
import { AdvisoryCrossDomainEventTypes } from './domain/events';

export class AdvisoryAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-adpt',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'advisory-adpt', domain: 'advisory', environment: prefix });

    // Resolve advisory domain bus
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Resolve target buses
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Cross-domain forwarding: Advisory → Investor
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

    // Cross-domain forwarding: Advisory → Execution
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

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toExecutionDlq],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-adpt',
        lambdaFunctions: [],
        dlqs: [toInvestorDlq, toExecutionDlq],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
