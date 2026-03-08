import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AdvisoryHubStack } from '../service.stack';

describe('AdvisoryHubStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new AdvisoryHubStack(app, 'test-advisory-hub');
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
      Description: 'Advisory event hub bus ARN',
    });
  });

  it('creates cross-domain forwarding rules', () => {
    // ToInvestor + ToExecution
    template.resourceCountIs('AWS::Events::Rule', 2);
  });
});
