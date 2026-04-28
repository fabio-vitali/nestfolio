import { Template, Match } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import {
  BedrockUsageAlarms,
  importCostAlertTopic,
} from '../../src/extensions/bedrock-usage-alarms';

describe('BedrockUsageAlarms construct', () => {
  describe('with defaults', () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const topic = new Topic(stack, 'AlertTopic');
      new BedrockUsageAlarms(stack, 'BedrockAlarms', {
        serviceName: 'onboarding-bff',
        modelIds: ['us.anthropic.claude-haiku-4-5-20251001-v1:0'],
        alertTopic: topic,
      });
      template = Template.fromStack(stack);
    });

    it('creates exactly three alarms (Invocations + Input + Output tokens)', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });

    it('alarms include the service name in the alarm name', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-invocations',
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-input-tokens',
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-output-tokens',
      });
    });

    it('uses default invocation threshold of 100 / 5 min', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-invocations',
        Threshold: 100,
        Period: 300,
      });
    });

    it('dimensions every alarm by ModelId for tight attribution', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-invocations',
        Dimensions: Match.arrayWith([
          Match.objectLike({
            Name: 'ModelId',
            Value: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
          }),
        ]),
      });
    });

    it('uses NOT_BREACHING for missing data so a quiet service does not alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-invocations',
        TreatMissingData: 'notBreaching',
      });
    });

    it('wires the SNS topic as the alarm action', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'onboarding-bff-bedrock-invocations',
        AlarmActions: Match.arrayEquals([{ Ref: Match.stringLikeRegexp('AlertTopic') }]),
      });
    });
  });

  describe('with overridden thresholds', () => {
    it('honours custom thresholds', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const topic = new Topic(stack, 'AlertTopic');
      new BedrockUsageAlarms(stack, 'BedrockAlarms', {
        serviceName: 'advisory-ctrl',
        modelIds: ['us.anthropic.claude-sonnet-4-6'],
        alertTopic: topic,
        invocationsPer5MinThreshold: 50,
        inputTokensPer5MinThreshold: 250_000,
        outputTokensPer5MinThreshold: 50_000,
      });
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'advisory-ctrl-bedrock-invocations',
        Threshold: 50,
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'advisory-ctrl-bedrock-input-tokens',
        Threshold: 250_000,
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'advisory-ctrl-bedrock-output-tokens',
        Threshold: 50_000,
      });
    });
  });
});

describe('BedrockUsageAlarms with multiple modelIds', () => {
  it('emits one alarm set per model with model-tier suffix', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const topic = new Topic(stack, 'AlertTopic');
    new BedrockUsageAlarms(stack, 'BedrockAlarms', {
      serviceName: 'advisory-ctrl',
      modelIds: [
        'us.anthropic.claude-opus-4-6-v1',
        'us.anthropic.claude-sonnet-4-6',
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      ],
      alertTopic: topic,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 9); // 3 alarms × 3 models
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'advisory-ctrl-bedrock-invocations-opus',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'advisory-ctrl-bedrock-input-tokens-sonnet',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'advisory-ctrl-bedrock-output-tokens-haiku',
    });
  });

  it('throws when modelIds is empty', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const topic = new Topic(stack, 'AlertTopic');
    expect(() => new BedrockUsageAlarms(stack, 'BedrockAlarms', {
      serviceName: 'svc',
      modelIds: [],
      alertTopic: topic,
    })).toThrow(/at least one modelId/);
  });
});

describe('importCostAlertTopic helper', () => {
  it('returns an ITopic that synths without errors', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const topic = importCostAlertTopic(
      stack,
      'ImportedTopic',
      '/nestfolio/dev-investor/cost-controls/alertTopicArn',
    );
    expect(topic).toBeDefined();
    expect(topic.topicArn).toBeDefined();
    // BedrockUsageAlarms must be wireable with the imported topic
    new BedrockUsageAlarms(stack, 'Alarms', {
      serviceName: 'svc',
      modelIds: ['model'],
      alertTopic: topic,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
  });
});
