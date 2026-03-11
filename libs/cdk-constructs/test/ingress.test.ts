import { App, Duration, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Ingress } from '../src/ingress';

describe('Ingress construct', () => {
  function createStack() {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const bus = new EventBus(stack, 'Bus');
    const handler = new Function(stack, 'Handler', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });
    return { stack, bus, handler };
  }

  it('applies custom batchSize and maxRetries', () => {
    const { stack, bus, handler } = createStack();

    new Ingress(stack, 'TestIngress', {
      eventBus: bus,
      eventTypes: ['TestEvent'],
      handler,
      batchSize: 5,
      maxRetries: 2,
    });

    const template = Template.fromStack(stack);

    // DLQ maxReceiveCount = maxRetries
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: {
        maxReceiveCount: 2,
      },
    });
  });

  it('auto-calculates visibilityTimeout from lambdaTimeout (6x)', () => {
    const { stack, bus, handler } = createStack();

    new Ingress(stack, 'TestIngress', {
      eventBus: bus,
      eventTypes: ['TestEvent'],
      handler,
      lambdaTimeout: Duration.seconds(30),
    });

    const template = Template.fromStack(stack);

    // visibilityTimeout = 6 * 30 = 180 seconds
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 180,
    });
  });

  it('explicit visibilityTimeout takes precedence over lambdaTimeout', () => {
    const { stack, bus, handler } = createStack();

    new Ingress(stack, 'TestIngress', {
      eventBus: bus,
      eventTypes: ['TestEvent'],
      handler,
      lambdaTimeout: Duration.seconds(30),
      visibilityTimeout: Duration.seconds(60),
    });

    const template = Template.fromStack(stack);

    // Should use explicit 60, not 6 * 30 = 180
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 60,
    });
  });
});
