import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags } from '@nestfolio/cdk-constructs';

export class ExecutionHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'execution',
      service: 'execution-hub',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'execution-hub', domain: 'execution', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'ExecutionBus', {
      eventBusName: naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM for cross-domain discovery
    new StringParameter(this, 'BusArnParam', {
      parameterName: naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Execution event hub bus ARN',
    });

    // Cross-domain forwarding: Execution --> Investor
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);
    const toInvestorDlq = new Queue(this, 'ToInvestorDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToInvestor', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'ORDER_FILLED',
          'ORDER_PARTIALLY_FILLED',
          'ORDER_REJECTED',
          'ORDER_CANCELLED',
          'ORDER_STAGED',
          'DEPOSIT_DETECTED',
          'WITHDRAWAL_COMPLETED',
          'WITHDRAWAL_REJECTED',
          'CORPORATE_ACTION_APPLIED',
          'RECONCILIATION_COMPLETED',
          'RECONCILIATION_FAILED',
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });

    // Cross-domain forwarding: Execution --> Advisory
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'ORDER_FILLED',
          'ORDER_REJECTED',
          'ORDER_CANCELLED',
          'DEPOSIT_DETECTED',
          'PORTFOLIO_DRIFT_DETECTED',
          'BROKER_SESSION_LOST',
          'STREAM_DISCONNECTED',
          'RECONCILIATION_FAILED',
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    // Monitoring: CloudWatch alarms for EventBridge failures, forwarding DLQs
    new Monitoring(this, 'Monitoring', {
      dlqs: [toInvestorDlq, toAdvisoryDlq],
      eventBusBusNames: [naming.eventBusName()],
    });

    // Dashboard: CloudWatch dashboard for hub observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'execution-hub',
      lambdaFunctions: [],
      dlqs: [toInvestorDlq, toAdvisoryDlq],
      eventBusNames: [naming.eventBusName()],
    });
  }
}
