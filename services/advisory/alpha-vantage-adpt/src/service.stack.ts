import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import {
  ServiceStack,
  ServiceStackProps,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
  AdapterSchedule,
} from '@nestfolio/cdk-constructs';

export class AlphaVantageAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceStackProps & { schedule?: { enabled: boolean; rate: string } },
  ) {
    super(scope, id, props);

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

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

    const avApiKey = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/alpha-vantage-api-key`,
    );

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(90),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'alpha-vantage-adpt',
        KB_BUCKET: kbBucketName,
        ALPHA_VANTAGE_API_KEY: avApiKey,
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
