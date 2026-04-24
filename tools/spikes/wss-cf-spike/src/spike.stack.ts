import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  OriginProtocolPolicy,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SpikeStackProps extends StackProps {
  appsyncRealtimeHost: string;
}

export class SpikeStack extends Stack {
  constructor(scope: Construct, id: string, props: SpikeStackProps) {
    super(scope, id, props);

    const rewriteFn = new CfFunction(this, 'PathRewriteFn', {
      code: FunctionCode.fromInline(
        readFileSync(join(__dirname, 'path-rewrite.fn.js'), 'utf-8'),
      ),
      comment: 'Rewrites /realtime/<domain> to /graphql',
    });

    const origin = new HttpOrigin(props.appsyncRealtimeHost, {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          { function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      comment: 'WSS-through-CloudFront spike — throwaway',
    });
    distribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new StringParameter(this, 'SpikeDistributionDomain', {
      parameterName: '/nestfolio/spike/wss-cf/distributionDomain',
      stringValue: distribution.distributionDomainName,
    });

    new CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
    });
  }
}
