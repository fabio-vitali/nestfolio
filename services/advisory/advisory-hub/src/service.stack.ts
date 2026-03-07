import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService } from '@nestfolio/cdk-constructs';

export class AdvisoryHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-hub',
    });

    // Domain bus
    this.bus = new EventBus(this, 'AdvisoryBus', {
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
      description: 'Advisory event hub bus ARN',
    });

    const prefix = this.node.tryGetContext('prefix') ?? 'dev';

    // Cross-domain forwarding: Advisory --> Investor
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);
    new Rule(this, 'ToInvestor', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'DECISION_PACKET_CREATED',
          'USER_CONFIRMATION_REQUESTED',
          'EXPLANATION_GENERATED',
          'DECISION_APPROVED',
          'DECISION_BLOCKED',
          'ESCALATION_TRIGGERED',
          'CIRCUIT_BREAKER_TRIGGERED',
          'CIRCUIT_BREAKER_RESET',
          'INCIDENT_DETECTED',
          'INCIDENT_RESOLVED',
        ],
      },
      targets: [new EventBusTarget(investorBus)],
    });

    // Cross-domain forwarding: Advisory --> Execution
    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);
    new Rule(this, 'ToExecution', {
      eventBus: this.bus,
      eventPattern: {
        detailType: [
          'DECISION_APPROVED',
          'USER_CONFIRMED',
          'CIRCUIT_BREAKER_TRIGGERED',
          'CIRCUIT_BREAKER_RESET',
        ],
      },
      targets: [new EventBusTarget(executionBus)],
    });
  }
}
