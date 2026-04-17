import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorHubStack } from '../../src/service.stack';

describe('InvestorHubStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new InvestorHubStack(app, 'test-investor-hub', {
      prefix: 'test',
      subsystem: 'investor',
      service: 'investor-hub',
    });
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
      Description: 'Investor event hub bus ARN',
    });
  });

  it('does not create cross-domain forwarding rules (moved to adapter)', () => {
    template.resourceCountIs('AWS::Events::Rule', 0);
  });

  it('does not create DLQs (moved to adapter)', () => {
    template.resourceCountIs('AWS::SQS::Queue', 0);
  });

  it('includes CostControls construct', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: {
        BudgetLimit: { Amount: 200, Unit: 'USD' },
      },
    });
  });

  it('applies standard tags to taggable resources', () => {
    template.hasResourceProperties('AWS::Events::EventBus', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'investor-hub' }),
      ]),
    });
    template.hasResourceProperties('AWS::Events::EventBus', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'nestfolio' }),
      ]),
    });
  });
});
