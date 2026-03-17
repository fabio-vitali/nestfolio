import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Archive } from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, Monitoring, ServiceDashboard, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';

export class AdvisoryHubStack extends Stack {
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'advisory',
      service: 'advisory-hub',
    });

    const prefix = getPrefix(this);
    const observability = this.node.tryGetContext('observability') !== 'false';
    applyStandardTags(this, { service: 'advisory-hub', domain: 'advisory', environment: prefix });

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

    // Bedrock model IDs — single source of truth for all advisory services
    new StringParameter(this, 'ModelOpusParam', {
      parameterName: naming.ssmParameterPath('models/opus'),
      stringValue: 'anthropic.claude-opus-4-6-20250501-v1:0',
      description: 'Bedrock model ID for Opus tier',
    });

    new StringParameter(this, 'ModelSonnetParam', {
      parameterName: naming.ssmParameterPath('models/sonnet'),
      stringValue: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
      description: 'Bedrock model ID for Sonnet tier',
    });

    new StringParameter(this, 'ModelHaikuParam', {
      parameterName: naming.ssmParameterPath('models/haiku'),
      stringValue: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      description: 'Bedrock model ID for Haiku tier',
    });

    if (observability) {
      new Monitoring(this, 'Monitoring', {
        dlqs: [],
        eventBusBusNames: [naming.eventBusName()],
      });

      new ServiceDashboard(this, 'Dashboard', {
        serviceName: 'advisory-hub',
        lambdaFunctions: [],
        dlqs: [],
        eventBusNames: [naming.eventBusName()],
      });
    }
  }
}
