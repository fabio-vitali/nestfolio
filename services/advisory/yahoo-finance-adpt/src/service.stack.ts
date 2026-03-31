import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { YahooFinanceAdptEventTypes } from './domain/events';

export class YahooFinanceAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceStackProps & { schedule?: { enabled: boolean; rate: string }; tickers?: string },
  ) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };
    const tickers = props.tickers ?? 'VTI,BND,QQQ,VTIP,SPY';

    const domainAccounts = getDomainAccounts(this);
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', props.prefix, 'advisory', domainAccounts);
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Override the default event bus to the advisory bus
    this.eventBus = advisoryBus;

    // Ingress: subscribes to FETCH_REQUESTED, materializes YahooFinanceArticle records into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [YahooFinanceAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(60),
      environment: {
        TICKERS: tickers,
      },
    });

    // Egress: DDB Stream → CDC → EventBridge
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'YahooFinanceArticle': { insert: 'YAHOO_FINANCE_UPDATED' },
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
        SERVICE_NAME: 'yahoo-finance-adpt',
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
