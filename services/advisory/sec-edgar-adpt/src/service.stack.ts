import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { Monitoring, ServiceDashboard } from '@nestfolio/cdk-constructs/observability';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';

export class SecEdgarAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: ServiceStackProps & { schedule?: { enabled: boolean; rate: string } },
  ) {
    super(scope, id, props);

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const domainAccounts = getDomainAccounts(this);
    const advisoryBusArn = resolveBusArn(this, 'AdvisoryBus', props.prefix, 'advisory', domainAccounts);
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
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'sec-edgar-adpt',
        KB_BUCKET: kbBucketName,
        TRACKED_CIKS: '0000102909,0000088053,0000914208',
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
