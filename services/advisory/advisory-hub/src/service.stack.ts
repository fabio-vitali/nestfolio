import { Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs';

export class AdvisoryHubStack extends ServiceStack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, stateProps: false });

    // Domain bus
    this.bus = new EventBus(this, 'AdvisoryBus', {
      eventBusName: this.naming.eventBusName(),
    });

    // Event archive for replay
    new Archive(this, 'Archive', {
      sourceEventBus: this.bus,
      archiveName: `${this.naming.eventBusName()}-archive`,
      retention: Duration.days(365),
      eventPattern: { source: [{ prefix: '' }] as any },
    });

    // Publish bus ARN to SSM for cross-domain discovery
    new StringParameter(this, 'BusArnParam', {
      parameterName: this.naming.ssmParameterPath('event-hub/busArn'),
      stringValue: this.bus.eventBusArn,
      description: 'Advisory event hub bus ARN',
    });

    // Bedrock model IDs — single source of truth for all advisory services
    new StringParameter(this, 'ModelOpusParam', {
      parameterName: this.naming.ssmParameterPath('models/opus'),
      stringValue: 'anthropic.claude-opus-4-6-20250501-v1:0',
      description: 'Bedrock model ID for Opus tier',
    });

    new StringParameter(this, 'ModelSonnetParam', {
      parameterName: this.naming.ssmParameterPath('models/sonnet'),
      stringValue: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
      description: 'Bedrock model ID for Sonnet tier',
    });

    new StringParameter(this, 'ModelHaikuParam', {
      parameterName: this.naming.ssmParameterPath('models/haiku'),
      stringValue: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      description: 'Bedrock model ID for Haiku tier',
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [this.naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [this.naming.eventBusName()],
      });
    }
  }
}
