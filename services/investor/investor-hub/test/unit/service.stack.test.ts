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

  it('includes the monthly $200 budget from CostControls', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'nestfolio-monthly',
        BudgetLimit: { Amount: 200, Unit: 'USD' },
      }),
    });
  });

  it('includes the daily $30 budget (P1 — 2026-04-28 cost safeguards)', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'nestfolio-daily',
        TimeUnit: 'DAILY',
        BudgetLimit: { Amount: 30, Unit: 'USD' },
      }),
    });
  });

  it('uses the tightened spike-alarm threshold of $15 / 6h (0.075 of $200)', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'nestfolio-billing-spike',
      Threshold: 15,
    });
  });

  it('exports the cost-alert SNS topic ARN to SSM for per-service BedrockUsageAlarms', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-investor/cost-controls/alertTopicArn',
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
