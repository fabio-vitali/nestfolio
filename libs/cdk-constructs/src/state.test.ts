import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { AttributeType, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { State } from './state';

describe('State construct', () => {
  let template: Template;

  describe('with default props', () => {
    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new State(stack, 'TestState');
      template = Template.fromStack(stack);
    });

    it('creates a DynamoDB table with PAY_PER_REQUEST billing', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('creates a table with pk/sk key schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      });
    });

    it('enables DynamoDB Streams with NEW_AND_OLD_IMAGES', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        StreamSpecification: {
          StreamViewType: 'NEW_AND_OLD_IMAGES',
        },
      });
    });

    it('enables TTL on the "ttl" attribute', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      });
    });

    it('enables Point-in-Time Recovery', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it('creates the tenantId-index GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'tenantId-index',
            KeySchema: [
              { AttributeName: 'tenantId', KeyType: 'HASH' },
              { AttributeName: '__typename', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });

    it('creates the typename-timestamp-index GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'typename-timestamp-index',
            KeySchema: [
              { AttributeName: '__typename', KeyType: 'HASH' },
              { AttributeName: 'timestamp', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'KEYS_ONLY' },
          }),
        ]),
      });
    });

    it('creates exactly 2 GSIs by default', () => {
      const tables = template.findResources('AWS::DynamoDB::Table');
      const tableKey = Object.keys(tables)[0];
      const gsis = tables[tableKey].Properties.GlobalSecondaryIndexes;
      expect(gsis).toHaveLength(2);
    });

    it('does not create an S3 bucket by default', () => {
      template.resourceCountIs('AWS::S3::Bucket', 0);
    });

    it('sets removal policy to DESTROY', () => {
      const tables = template.findResources('AWS::DynamoDB::Table');
      const tableKey = Object.keys(tables)[0];
      expect(tables[tableKey].DeletionPolicy).toBe('Delete');
    });
  });

  describe('with withBucket=true', () => {
    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new State(stack, 'TestState', { withBucket: true });
      template = Template.fromStack(stack);
    });

    it('creates an S3 bucket', () => {
      template.resourceCountIs('AWS::S3::Bucket', 1);
    });

    it('creates a versioned S3 bucket with S3-managed encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: { Status: 'Enabled' },
      });
    });
  });

  describe('with additional GSIs', () => {
    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new State(stack, 'TestState', {
        additionalGsis: [
          {
            indexName: 'custom-index',
            partitionKey: { name: 'customPk', type: AttributeType.STRING },
            sortKey: { name: 'customSk', type: AttributeType.STRING },
            projectionType: ProjectionType.KEYS_ONLY,
          },
        ],
      });
      template = Template.fromStack(stack);
    });

    it('creates 3 GSIs total (2 default + 1 additional)', () => {
      const tables = template.findResources('AWS::DynamoDB::Table');
      const tableKey = Object.keys(tables)[0];
      const gsis = tables[tableKey].Properties.GlobalSecondaryIndexes;
      expect(gsis).toHaveLength(3);
    });

    it('includes the custom GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'custom-index',
            KeySchema: [
              { AttributeName: 'customPk', KeyType: 'HASH' },
              { AttributeName: 'customSk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'KEYS_ONLY' },
          }),
        ]),
      });
    });
  });
});
