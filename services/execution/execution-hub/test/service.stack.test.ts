import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExecutionHubStack } from '../src/service.stack';

describe('ExecutionHubStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ExecutionHubStack(app, 'test-execution-hub');
    template = Template.fromStack(stack);
  });

  it('creates an EventBridge bus', () => {
    template.resourceCountIs('AWS::Events::EventBus', 1);
  });

  it('creates an event archive with 365-day retention', () => {
    template.hasResourceProperties('AWS::Events::Archive', {
      RetentionDays: 365,
    });
  });

  it('publishes bus ARN to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Description: 'Execution event hub bus ARN',
    });
  });

  it('creates cross-domain forwarding rules', () => {
    // ToInvestor + ToAdvisory + ToLedger
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('creates DLQs for cross-domain forwarding rule targets', () => {
    const queues = template.findResources('AWS::SQS::Queue', {
      Properties: {
        MessageRetentionPeriod: 1209600,
      },
    });
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(3);
  });

  it('applies standard tags to taggable resources', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'execution-hub' }),
      ]),
    });
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'nestfolio' }),
      ]),
    });
  });
});
