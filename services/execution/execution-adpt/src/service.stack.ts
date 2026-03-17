import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';
import { ExecutionCrossDomainEventTypes } from './domain/events';

export class ExecutionAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'execution-adpt',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'execution-adpt', domain: 'execution', environment: prefix });

    // Resolve execution domain bus
    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);

    // Resolve target buses
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
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

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toLedgerDlq, toAdvisoryDlq],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'execution-adpt',
        lambdaFunctions: [],
        dlqs: [toInvestorDlq, toLedgerDlq, toAdvisoryDlq],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
