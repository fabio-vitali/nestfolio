import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
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
 *   investor-web CloudFront stack can discover origins per BFF.
 */
export class MfeBucket extends Construct {
  readonly bucket: IBucket;
  readonly mfeKey: string;

  constructor(scope: Construct, id: string, props: MfeBucketProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { naming, prefix } = serviceStack;
    const account = serviceStack.account;
    this.mfeKey = props.mfeKey;

    const isProd = serviceStack.production;

    this.bucket = new Bucket(this, 'Bucket', {
      bucketName: naming.mfeBucketName(account, props.mfeKey),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // CloudFront OAC bucket policy. The single CloudFront distribution lives
    // in investor-web regardless of which BFF/subsystem instantiates this
    // construct, so the SSM lookup hard-codes the `<prefix>-investor`
    // subsystem path. Resolved at deploy-time via the standard CloudFormation
    // `{{resolve:ssm:...}}` dynamic reference, which AWS supports inside
    // S3::BucketPolicy.PolicyDocument.
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
