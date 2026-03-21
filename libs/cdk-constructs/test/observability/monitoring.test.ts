import { Template } from 'aws-cdk-lib/assertions';
import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Monitoring } from '../../src/observability/monitoring';

describe('Monitoring construct', () => {
  describe('with Lambda functions', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const fn = new Function(stack, 'TestFn', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({})'),
        timeout: Duration.seconds(30),
      });

      new Monitoring(stack, 'TestMonitoring', {
        lambdaFunctions: [fn],
      });

      template = Template.fromStack(stack);
    });

    it('creates Lambda error alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
    });

    it('creates Lambda duration alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Duration',
        Namespace: 'AWS/Lambda',
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('creates Lambda throttles alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Throttles',
        Namespace: 'AWS/Lambda',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
    });

    it('creates an SNS alarm topic', () => {
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('creates 3 alarms for one Lambda function', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });
  });

  describe('with DLQs', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const dlq = new Queue(stack, 'TestDLQ');

      new Monitoring(stack, 'TestMonitoring', {
        dlqs: [dlq],
      });

      template = Template.fromStack(stack);
    });

    it('creates DLQ messages visible alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Namespace: 'AWS/SQS',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
    });
  });

  describe('with EventBridge bus names', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');

      new Monitoring(stack, 'TestMonitoring', {
        eventBusBusNames: ['test-bus'],
      });

      template = Template.fromStack(stack);
    });

    it('creates EventBridge failed invocations alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'FailedInvocations',
        Namespace: 'AWS/Events',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
    });
  });

  describe('with Bedrock monitoring', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');

      new Monitoring(stack, 'TestMonitoring', {
        monitorBedrock: true,
        bedrockModelIds: ['anthropic.claude-haiku-4-5-20251001-v1:0'],
      });

      template = Template.fromStack(stack);
    });

    it('creates Bedrock invocation errors alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'InvocationClientErrors',
        Namespace: 'AWS/Bedrock',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
      });
    });
  });

  describe('with custom alarm topic', () => {
    it('uses the provided SNS topic', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const topic = new Topic(stack, 'CustomTopic');
      const dlq = new Queue(stack, 'TestDLQ');

      const monitoring = new Monitoring(stack, 'TestMonitoring', {
        alarmTopic: topic,
        dlqs: [dlq],
      });

      expect(monitoring.alarmTopic).toBe(topic);

      const template = Template.fromStack(stack);
      // Only the custom topic, no auto-created topic
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });
  });
});
