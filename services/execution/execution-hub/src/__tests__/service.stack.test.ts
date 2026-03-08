import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ExecutionHubStack } from '../service.stack';

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
    // ToInvestor + ToAdvisory
    template.resourceCountIs('AWS::Events::Rule', 2);
  });
});
