import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Distribution, ViewerProtocolPolicy, AllowedMethods, CachePolicy,
  Function as CfFunction, FunctionEventType, OriginRequestPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { MfeCatalogEntry } from './mfe-catalog';

/**
 * Adds a CloudFront cache behavior for an MFE bundle bucket.
 *
 * Charter §7 R6 row 2: /mfe/<key>/* → that BFF's S3 bucket (SSM-discovered).
 * Bucket policy already grants CloudFront OAC access (provisioned by A3 in
 * the BFF stack).
 */
export function addMfeBucketBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
): void {
  const bucketName = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/mfe/bucketName`,
  );
  const bucket = Bucket.fromBucketName(scope, `MfeBucket-${entry.key}`, bucketName);

  distribution.addBehavior(`/mfe/${entry.key}/*`, S3BucketOrigin.withOriginAccessControl(bucket), {
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
  });
}

/**
 * Adds a CloudFront cache behavior for a BFF's AppSync HTTPS endpoint.
 *
 * Charter §7 R6 row 3: /graphql/<domain> → that BFF's AppSync HTTPS
 * endpoint. Hostname constructed from the SSM-discovered api/apiId
 * + Stack region. Viewer-request rewrite strips /<domain> so AppSync
 * sees /graphql.
 */
export function addGraphqlBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
  rewriteFn: CfFunction,
): void {
  if (!entry.hasFacade) {
    throw new Error(`addGraphqlBehavior called for ${entry.key} which has no Facade`);
  }
  const apiId = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/api/apiId`,
  );
  const region = Stack.of(scope).region;
  const httpHost = `${apiId}.appsync-api.${region}.amazonaws.com`;

  distribution.addBehavior(`/graphql/${entry.key}`, new HttpOrigin(httpHost), {
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
  });
}

/**
 * Adds a CloudFront cache behavior for a BFF's AppSync WSS endpoint.
 *
 * Charter §7 R6 row 4: /realtime/<domain> → that BFF's AppSync WSS endpoint.
 * Hostname constructed from the SSM-discovered api/apiId + Stack region.
 * Viewer-request rewrite strips /<domain> so AppSync sees /graphql (it
 * uses the same /graphql URI for both HTTPS and WSS handshakes).
 *
 * V1 spike validated this transport configuration end-to-end against
 * a real AppSync subscription.
 */
export function addRealtimeBehavior(
  scope: Construct,
  distribution: Distribution,
  prefix: string,
  entry: MfeCatalogEntry,
  rewriteFn: CfFunction,
): void {
  if (!entry.hasFacade) {
    throw new Error(`addRealtimeBehavior called for ${entry.key} which has no Facade`);
  }
  const apiId = StringParameter.valueForStringParameter(
    scope, `/nestfolio/${prefix}-${entry.service}/api/apiId`,
  );
  const region = Stack.of(scope).region;
  const wsHost = `${apiId}.appsync-realtime-api.${region}.amazonaws.com`;

  distribution.addBehavior(`/realtime/${entry.key}`, new HttpOrigin(wsHost), {
    viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ function: rewriteFn, eventType: FunctionEventType.VIEWER_REQUEST }],
  });
}
