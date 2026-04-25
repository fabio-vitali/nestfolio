import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ServiceStack } from '../../src/core/service-stack';
import { MfeBucket } from '../../src/extensions/mfe-bucket';

function synthMfeBucket(opts: { prefix?: string; mfeKey?: string } = {}): Template {
  const app = new App();
  const stack = new ServiceStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    prefix: opts.prefix ?? 'dev',
    subsystem: 'investor',
    service: 'investor-bff',
    observability: false,
  });
  new MfeBucket(stack, 'MfeBucket', { mfeKey: opts.mfeKey ?? 'investor' });
  return Template.fromStack(stack);
}

describe('MfeBucket construct', () => {
  it('creates exactly 1 S3 bucket', () => {
    const template = synthMfeBucket();
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('creates an S3 bucket with S3-managed encryption and all-public-access blocked', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('names the bucket per NamingService.mfeBucketName', () => {
    const template = synthMfeBucket({ prefix: 'dev', mfeKey: 'advisory' });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: '123456789012-dev-nestfolio-mfe-advisory',
    });
  });

  it('uses RemovalPolicy DESTROY in non-prod', () => {
    const template = synthMfeBucket({ prefix: 'dev' });
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });

  it('uses RemovalPolicy RETAIN in prod', () => {
    const template = synthMfeBucket({ prefix: 'prod' });
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('grants CloudFront OAC s3:GetObject scoped via AWS:SourceArn', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 's3:GetObject',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Condition: {
              StringEquals: {
                'AWS:SourceArn': Match.objectLike({
                  'Fn::Join': [
                    '',
                    Match.arrayWith([
                      Match.stringLikeRegexp('^arn:aws:cloudfront::'),
                    ]),
                  ],
                }),
              },
            },
          }),
        ]),
      }),
    });
  });

  it('exports mfe/bucketName SSM parameter at service-scoped path', () => {
    const template = synthMfeBucket();
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/dev-investor-bff/mfe/bucketName',
    });
  });

  it('exports mfe/key SSM parameter at service-scoped path with the literal key', () => {
    const template = synthMfeBucket({ mfeKey: 'dashboard' });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: Match.stringLikeRegexp('/mfe/key$'),
      Value: 'dashboard',
    });
  });

  it('exposes bucket and mfeKey on the construct instance', () => {
    const app = new App();
    const stack = new ServiceStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      prefix: 'dev',
      subsystem: 'investor',
      service: 'investor-bff',
      observability: false,
    });
    const mfeBucket = new MfeBucket(stack, 'MfeBucket', { mfeKey: 'investor' });
    expect(mfeBucket.mfeKey).toBe('investor');
    expect(mfeBucket.bucket).toBeDefined();
  });
});
