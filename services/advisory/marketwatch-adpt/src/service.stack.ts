import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { MarketwatchAdptEventTypes } from './domain/events';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';

export class MarketwatchAdptStack extends ServiceStack {
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

    const ssmBasePath = `/nestfolio/${props.prefix}-marketwatch-adpt/marketwatch`;

    new StringParameter(this, 'BaseUrl', {
      parameterName: `${ssmBasePath}/baseUrl`,
      stringValue: 'https://feeds.marketwatch.com/marketwatch',
      description: 'MarketWatch RSS base URL (overridable for integration tests)',
    });

    // Ingress: subscribes to FETCH_REQUESTED, materializes MarketWatchArticle records into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [MarketwatchAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      environment: {
        MARKETWATCH_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });

    // IAM: SSM access for ParamsAndSecrets Extension
    ingress.handler.addToRolePolicy(new PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${ssmBasePath}/*`],
    }));

    // Egress: DDB Stream → CDC → EventBridge
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'MarketWatchArticle': {
          insert: MarketwatchAdptEventTypes.MARKETWATCH_UPDATED,
          modify: MarketwatchAdptEventTypes.MARKETWATCH_UPDATED,
        },
      },
    });

    // Trigger Lambda: invoked by EventBridge Scheduler, publishes FETCH_REQUESTED to bus
    const fetchTrigger = new NodejsFunction(this, 'FetchTrigger', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'fetch-trigger.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'marketwatch-adpt',
      },
    });

    advisoryBus.grantPutEventsTo(fetchTrigger);

    new AdapterSchedule(this, 'FetchSchedule', {
      target: fetchTrigger,
      scheduleExpression: scheduleConfig.rate,
      enabled: scheduleConfig.enabled,
    });

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [fetchTrigger],
    });
  }
}
