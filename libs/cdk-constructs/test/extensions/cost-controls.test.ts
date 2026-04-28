import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { CostControls } from '../../src/extensions/cost-controls';

describe('CostControls construct', () => {
  describe('with defaults', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new CostControls(stack, 'CostControls', {
        alertEmail: 'alerts@example.com',
        monthlyBudgetUsd: 200,
      });
      template = Template.fromStack(stack);
    });

    it('creates the monthly $200 budget', () => {
      template.hasResourceProperties('AWS::Budgets::Budget', {
        Budget: Match.objectLike({
          BudgetName: 'nestfolio-monthly',
          TimeUnit: 'MONTHLY',
          BudgetLimit: { Amount: 200, Unit: 'USD' },
        }),
      });
    });

    it('creates the daily $30 budget by default (P1 — daily detection)', () => {
      template.hasResourceProperties('AWS::Budgets::Budget', {
        Budget: Match.objectLike({
          BudgetName: 'nestfolio-daily',
          TimeUnit: 'DAILY',
          BudgetLimit: { Amount: 30, Unit: 'USD' },
        }),
      });
    });

    it('creates two budgets total (monthly + daily)', () => {
      template.resourceCountIs('AWS::Budgets::Budget', 2);
    });

    it('uses the tightened spike-alarm threshold of 7.5% by default ($15 on $200/mo)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'nestfolio-billing-spike',
        Threshold: 15,
      });
    });

    it('subscribes the SNS topic to the email', () => {
      template.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'email',
        Endpoint: 'alerts@example.com',
      });
    });
  });

  describe('with custom dailyBudgetUsd and spikeRatio', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new CostControls(stack, 'CostControls', {
        alertEmail: 'alerts@example.com',
        monthlyBudgetUsd: 400,
        dailyBudgetUsd: 50,
        spikeRatio: 0.10,
      });
      template = Template.fromStack(stack);
    });

    it('overrides the daily budget amount', () => {
      template.hasResourceProperties('AWS::Budgets::Budget', {
        Budget: Match.objectLike({
          BudgetName: 'nestfolio-daily',
          BudgetLimit: { Amount: 50, Unit: 'USD' },
        }),
      });
    });

    it('applies the custom spikeRatio (0.10 of $400 = $40)', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'nestfolio-billing-spike',
        Threshold: 40,
      });
    });
  });

  describe('with alertTopicSsmExportPath', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      new CostControls(stack, 'CostControls', {
        alertEmail: 'alerts@example.com',
        monthlyBudgetUsd: 200,
        alertTopicSsmExportPath: '/nestfolio/dev-investor/cost-controls/alertTopicArn',
      });
      template = Template.fromStack(stack);
    });

    it('publishes the SNS topic ARN to SSM at the requested path', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: '/nestfolio/dev-investor/cost-controls/alertTopicArn',
      });
    });
  });

  describe('exposes alertTopic on the construct instance', () => {
    it('makes alertTopic available for cross-construct wiring', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const cc = new CostControls(stack, 'CostControls', {
        alertEmail: 'alerts@example.com',
        monthlyBudgetUsd: 200,
      });
      expect(cc.alertTopic).toBeDefined();
      expect(cc.alertTopic.topicArn).toBeDefined();
    });
  });
});
