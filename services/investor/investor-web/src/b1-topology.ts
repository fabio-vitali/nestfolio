import { Construct } from 'constructs';
import {
  Distribution, ViewerProtocolPolicy, AllowedMethods, CachePolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
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
