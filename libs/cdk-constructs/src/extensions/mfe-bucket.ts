import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess, IBucket } from 'aws-cdk-lib/aws-s3';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack } from '../core/service-stack';

export interface MfeBucketProps {
  /** URL key under `/mfe/<key>/*` (e.g. 'investor', 'advisory'). */
  readonly mfeKey: string;
}

/**
 * Per-MFE S3 bucket owned by a BFF stack.
 *
 * Provisions:
 * - An S3 bucket named via NamingService.mfeBucketName(account, mfeKey).
 * - A bucket policy granting cloudfront.amazonaws.com s3:GetObject, scoped via
 *   AWS:SourceArn to the investor-web CloudFront distribution (id resolved from
 *   SSM at deploy-time).
 * - SSM exports `mfe/bucketName` and `mfe/key` at service-scoped paths so the
 *   investor-web CloudFront stack (B1) can discover origins per BFF.
 *
 * Charter §5 row 9b, §6 BFF charter, §7 R6.
 */
export class MfeBucket extends Construct {
  readonly bucket: IBucket;
  readonly mfeKey: string;

  constructor(scope: Construct, id: string, props: MfeBucketProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { naming, prefix } = serviceStack;
    const account = Stack.of(this).account;
    this.mfeKey = props.mfeKey;

    const isProd = prefix === 'prod';

    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: naming.mfeBucketName(account, props.mfeKey),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // CloudFront OAC bucket policy. The distribution lives in investor-web
    // (charter §5 row 9a). Its id is exported to SSM by investor-web at the
    // canonical subsystem-scoped path.
    const distributionId = StringParameter.valueForStringParameter(
      this, `/nestfolio/${prefix}-investor/web/distributionId`,
    );
    const distributionArn = `arn:aws:cloudfront::${account}:distribution/${distributionId}`;

    this.bucket.addToResourcePolicy(new PolicyStatement({
      principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [`${this.bucket.bucketArn}/*`],
      conditions: {
        StringEquals: { 'AWS:SourceArn': distributionArn },
      },
    }));

    new StringParameter(this, 'BucketNameParam', {
      parameterName: naming.ssmServicePath('mfe/bucketName'),
      stringValue: this.bucket.bucketName,
      description: `MFE S3 bucket for ${props.mfeKey}`,
    });

    new StringParameter(this, 'KeyParam', {
      parameterName: naming.ssmServicePath('mfe/key'),
      stringValue: props.mfeKey,
      description: `MFE URL key for ${naming.service}`,
    });
  }
}
