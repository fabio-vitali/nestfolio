import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as os from 'os';
import { ServiceStack } from '../src/service-stack';
import { Egress } from '../src/egress';

describe('Egress construct', () => {
  function createEgress(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
    });

    const egress = new Egress(stack, 'TestEgress', {
      publishableTypes: ['Order', 'StagedOrder'],
      ...(overrides as any),
    });

    return { stack, egress, template: Template.fromStack(stack) };
  }

  it('creates DLQ with 14-day retention', () => {
    const { template } = createEgress();
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('creates publisher Lambda with BUS_NAME and SERVICE_NAME', () => {
    const { template } = createEgress();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          BUS_NAME: Match.anyValue(),
          SERVICE_NAME: 'test-svc',
        }),
      },
    });
  });

  it('grants PutEvents on the event bus', () => {
    const { template } = createEgress();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'events:PutEvents',
          }),
        ]),
      },
    });
  });

  it('sets CUSTOM_EVENT_TYPE_MAP env var when customEventTypeMap provided', () => {
    const { template } = createEgress({
      customEventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CUSTOM_EVENT_TYPE_MAP: Match.anyValue(),
        }),
      },
    });
  });

  it('exposes dlq property', () => {
    const { egress } = createEgress();
    expect(egress.dlq).toBeDefined();
  });
});
