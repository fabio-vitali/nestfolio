import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';
import { LedgerCrossDomainEventTypes } from './domain/events';

export class LedgerAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-adpt',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'ledger-adpt', domain: 'ledger', environment: prefix });

    // Resolve ledger domain bus
    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Resolve target buses
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Cross-domain forwarding: Ledger → Investor
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToInvestor', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          LedgerCrossDomainEventTypes.BALANCE_UPDATED,
          LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED,
          LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED,
          LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED,
          LedgerCrossDomainEventTypes.RECONCILIATION_FAILED,
          LedgerCrossDomainEventTypes.LEDGER_PROCESSING_FAILED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Ledger → Advisory
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: ledgerBus,
      eventPattern: {
        detailType: [
          LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED,
          LedgerCrossDomainEventTypes.PORTFOLIO_DRIFT_DETECTED,
          LedgerCrossDomainEventTypes.RECONCILIATION_FAILED,
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [toInvestorDlq, toAdvisoryDlq],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'ledger-adpt',
        lambdaFunctions: [],
        dlqs: [toInvestorDlq, toAdvisoryDlq],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
