import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { AdapterSchedule } from '../../src/extensions/adapter-schedule';

describe('AdapterSchedule construct', () => {
  describe('with enabled schedule', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(6 hours)',
        enabled: true,
      });

      template = Template.fromStack(stack);
    });

    it('creates an EventBridge Scheduler schedule', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'rate(6 hours)',
        State: 'ENABLED',
      });
    });

    it('targets the Lambda function', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Target: Match.objectLike({
          Arn: Match.anyValue(),
        }),
      });
    });

    it('uses FLEXIBLE time window of 15 minutes', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        FlexibleTimeWindow: {
          Mode: 'FLEXIBLE',
          MaximumWindowInMinutes: 15,
        },
      });
    });

    it('creates an IAM role for the scheduler', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: Match.objectLike({
                Service: 'scheduler.amazonaws.com',
              }),
            }),
          ]),
        }),
      });
    });
  });

  describe('with disabled schedule (sandbox)', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(24 hours)',
        enabled: false,
      });

      template = Template.fromStack(stack);
    });

    it('creates schedule in DISABLED state', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'rate(24 hours)',
        State: 'DISABLED',
      });
    });
  });

  describe('with retry configuration', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
      });

      new AdapterSchedule(stack, 'TestSchedule', {
        target: fn,
        scheduleExpression: 'rate(6 hours)',
        enabled: true,
        maxRetryAttempts: 2,
        maxEventAge: Duration.minutes(30),
      });

      template = Template.fromStack(stack);
    });

    it('sets retry policy on the target', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Target: Match.objectLike({
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 1800,
          },
        }),
      });
    });
  });
});
