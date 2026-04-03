import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { KnowledgeBase } from '../../src/extensions/knowledge-base';
import { AdapterSchedule } from '../../src/extensions/adapter-schedule';

describe('KnowledgeBase construct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    new KnowledgeBase(stack, 'TestKB', {
      kbName: 'regulatory',
      description: 'Regulatory & Compliance KB',
      embeddingModelId: 'amazon.titan-embed-text-v2:0',
    });
    template = Template.fromStack(stack);
  });

  it('creates an S3 bucket with block public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('creates an S3 bucket with versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('creates 2 S3 buckets (data source + vector index)', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  it('creates a Bedrock Knowledge Base', () => {
    template.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      Name: Match.stringLikeRegexp('regulatory'),
      Description: 'Regulatory & Compliance KB',
      KnowledgeBaseConfiguration: {
        Type: 'VECTOR',
        VectorKnowledgeBaseConfiguration: {
          EmbeddingModelArn: Match.stringLikeRegexp('amazon\\.titan-embed-text-v2'),
        },
      },
      StorageConfiguration: {
        Type: 'S3_VECTORS',
        S3VectorsConfiguration: {
          IndexName: Match.stringLikeRegexp('regulatory-index'),
          VectorBucketArn: Match.anyValue(),
        },
      },
    });
  });

  it('creates a Bedrock Data Source pointing to the S3 bucket', () => {
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataSourceConfiguration: {
        Type: 'S3',
        S3Configuration: {
          BucketArn: Match.anyValue(),
        },
      },
    });
  });

  it('creates an IAM role for the Knowledge Base', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: Match.objectLike({
              Service: 'bedrock.amazonaws.com',
            }),
          }),
        ]),
      }),
    });
  });
});

describe('KnowledgeBase + AdapterSchedule integration', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const kb = new KnowledgeBase(stack, 'MarketKB', {
      kbName: 'market',
      description: 'Market Intelligence KB',
    });

    const fn = new Function(stack, 'FetchFn', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    fn.addToRolePolicy(kb.triggerSyncPolicy());

    new AdapterSchedule(stack, 'FetchSchedule', {
      target: fn,
      scheduleExpression: 'rate(6 hours)',
      enabled: true,
    });

    template = Template.fromStack(stack);
  });

  it('creates S3 buckets and a Scheduler schedule', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });

  it('creates a Bedrock Knowledge Base', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
  });

  it('grants StartIngestionJob to the fetch Lambda', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:StartIngestionJob',
          }),
        ]),
      }),
    });
  });
});
