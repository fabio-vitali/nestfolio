import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, CostControls, Monitoring, ServiceDashboard, applyStandardTags } from '@nestfolio/cdk-constructs';

export class InvestorHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-hub',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'investor-hub', domain: 'investor', environment: prefix });

    // Domain bus
    this.bus = new EventBus(this, 'InvestorBus', {
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
      description: 'Investor event hub bus ARN',
    });

    // Cost controls (deployed in Phase 1 as part of investor-hub)
    const alertEmail = this.node.tryGetContext('alertEmail') ?? 'alerts@nestfolio.dev';
    new CostControls(this, 'CostControls', {
      alertEmail,
      monthlyBudgetUsd: 200,
    });

    // Cross-domain forwarding: Investor --> Advisory
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
          'GOAL_UPDATED',
          'RISK_PROFILE_UPDATED',
          'OPERATING_MODE_CHANGED',
          'MANDATE_GRANTED',
          'MANDATE_UPDATED',
          'MANDATE_REVOKED',
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    // Cross-domain forwarding: Investor --> Execution
    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);
    const toExecutionDlq = new Queue(this, 'ToExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToExecution', {
      eventBus: this.bus,
      eventPattern: {
        detailType: ['WITHDRAWAL_REQUESTED', 'ACCOUNT_CLOSURE_REQUESTED'],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
    });

    // Monitoring: CloudWatch alarms for EventBridge failures, forwarding DLQs
    new Monitoring(this, 'Monitoring', {
      dlqs: [toAdvisoryDlq, toExecutionDlq],
      eventBusBusNames: [naming.eventBusName()],
    });

    // Dashboard: CloudWatch dashboard for hub observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'investor-hub',
      lambdaFunctions: [],
      dlqs: [toAdvisoryDlq, toExecutionDlq],
      eventBusNames: [naming.eventBusName()],
    });
  }
}
