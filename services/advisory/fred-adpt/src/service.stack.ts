import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { FredAdptEventTypes } from './domain/events';

export class FredAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceStackProps & { schedule?: { enabled: boolean; rate: string } },
  ) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const domainAccounts = getDomainAccounts(this);
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', props.prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Override the default event bus to the advisory bus
    this.eventBus = advisoryBus;

    const fredApiKey = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/fred-api-key`,
    );

    // Ingress: subscribes to FETCH_REQUESTED, materializes FredIndicator records into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [FredAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(90),
      environment: {
        FRED_API_KEY: fredApiKey,
      },
    });

    // Egress: DDB Stream → CDC → EventBridge
    const egress = new Egress(this, 'Egress', {
      state,
      publishableTypes: ['FredIndicator'],
    });

    // Trigger Lambda: invoked by EventBridge Scheduler, publishes FETCH_REQUESTED to bus
    const fetchTrigger = new NodejsFunction(this, 'FetchTrigger', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'fetch-trigger.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'fred-adpt',
      },
    });

    advisoryBus.grantPutEventsTo(fetchTrigger);

    new AdapterSchedule(this, 'FetchSchedule', {
      target: fetchTrigger,
      scheduleExpression: scheduleConfig.rate,
      enabled: scheduleConfig.enabled,
    });

    this.addObservability({
      ingress: ingress.handler,
      egress: egress.handler,
      extra: [fetchTrigger],
    });
  }
}
