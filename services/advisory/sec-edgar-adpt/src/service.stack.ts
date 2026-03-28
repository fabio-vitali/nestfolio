import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { SecEdgarAdptEventTypes } from './domain/events';

export class SecEdgarAdptStack extends ServiceStack {
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

    // Ingress: subscribes to FETCH_SEC_EDGAR_REQUESTED, fetches EDGAR filings, materializes SecFiling records into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [SecEdgarAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(120),
      lambdaProps: { memorySize: 512 },
      environment: {
        TRACKED_CIKS: '0000102909,0000088053,0000914208',
      },
    });

    // Egress: DDB Stream → CDC → EventBridge (form-type-based event routing)
    const egress = new Egress(this, 'Egress', {
      state,
      publishableTypes: ['SecFiling'],
    });

    // Trigger Lambda: invoked by EventBridge Scheduler, publishes FETCH_SEC_EDGAR_REQUESTED to bus
    const fetchTrigger = new NodejsFunction(this, 'FetchTrigger', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'fetch-trigger.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'sec-edgar-adpt',
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
