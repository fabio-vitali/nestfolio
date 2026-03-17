import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';
import { InvestorCrossDomainEventTypes } from './domain/events';

export class InvestorAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-adpt',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'investor-adpt', domain: 'investor', environment: prefix });

    // Resolve investor domain bus
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // Resolve target buses
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
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

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toAdvisoryDlq, toExecutionDlq],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'investor-adpt',
        lambdaFunctions: [],
        dlqs: [toAdvisoryDlq, toExecutionDlq],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
