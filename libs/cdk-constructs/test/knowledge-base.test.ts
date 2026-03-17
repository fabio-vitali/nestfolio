import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { KnowledgeBase } from '../src/knowledge-base';

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

  it('creates exactly 1 S3 bucket', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
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
        Type: 'OPENSEARCH_SERVERLESS',
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
