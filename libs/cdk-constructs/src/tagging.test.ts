import { App, Stack } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { applyStandardTags } from './tagging';

describe('applyStandardTags', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    // Create a resource so we can verify tags are applied
    new Table(stack, 'TestTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    applyStandardTags(stack, {
      service: 'investor-bff',
      domain: 'investor',
      environment: 'dev',
    });

    template = Template.fromStack(stack);
  });

  it('applies Service tag', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'investor-bff' }),
      ]),
    });
  });

  it('applies Domain tag', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Domain', Value: 'investor' }),
      ]),
    });
  });

  it('applies Environment tag', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Environment', Value: 'dev' }),
      ]),
    });
  });

  it('applies ManagedBy tag', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'ManagedBy', Value: 'CDK' }),
      ]),
    });
  });

  it('applies Project tag', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'nestfolio' }),
      ]),
    });
  });
});
