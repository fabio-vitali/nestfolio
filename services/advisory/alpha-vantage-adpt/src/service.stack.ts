import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { ParamsAndSecretsLayerVersion, ParamsAndSecretsVersions } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { AlphaVantageAdptEventTypes } from './domain/events';

export class AlphaVantageAdptStack extends ServiceStack {
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

    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );

    const ssmBasePath = `/nestfolio/${props.prefix}-alpha-vantage-adpt/alpha-vantage`;

    new StringParameter(this, 'BaseUrl', {
      parameterName: `${ssmBasePath}/baseUrl`,
      stringValue: 'https://www.alphavantage.co/query',
      description: 'Alpha Vantage API base URL (overridable for integration tests)',
    });

    const avApiKey = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/alpha-vantage-api-key`,
    );

    // Ingress: subscribes to FETCH_REQUESTED, materializes articles/indicators into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [AlphaVantageAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(90),
      environment: {
        ALPHA_VANTAGE_API_KEY: avApiKey,
        ALPHA_VANTAGE_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
      lambdaProps: { paramsAndSecrets },
    });

    // IAM: SSM access for API key + ParamsAndSecrets Extension base URL
    ingress.handler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:*:parameter/nestfolio/${props.prefix}-advisory/alpha-vantage-api-key`,
          `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${ssmBasePath}/*`,
        ],
      }),
    );

    // Egress: DDB Stream → CDC → EventBridge
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AlphaVantageArticle': { insert: 'ALPHA_VANTAGE_NEWS_UPDATED' },
        'EconomicIndicator': { insert: 'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED' },
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
        SERVICE_NAME: 'alpha-vantage-adpt',
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
