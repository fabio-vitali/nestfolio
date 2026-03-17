import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
  AdapterSchedule,
} from '@nestfolio/cdk-constructs';

export class YahooFinanceAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
      tickers?: string;
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'yahoo-finance-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };
    const tickers = props.tickers ?? 'VTI,BND,QQQ,VTIP,SPY';

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(60),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'yahoo-finance-adpt',
        KB_BUCKET: kbBucketName,
        TICKERS: tickers,
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    new AdapterSchedule(this, 'FetchSchedule', {
      target: eventPublisher,
      scheduleExpression: scheduleConfig.rate,
      enabled: scheduleConfig.enabled,
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }
}
