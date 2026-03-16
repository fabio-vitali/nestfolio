import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceStack } from '../src/service-stack';
import { Egress } from '../src/egress';

describe('Egress construct', () => {
  const tmpHandler = path.join(os.tmpdir(), 'test-cdc-handler.ts');

  beforeAll(() => {
    fs.writeFileSync(tmpHandler, 'export const handler = async () => {};');
  });

  afterAll(() => {
    try { fs.unlinkSync(tmpHandler); } catch { /* ignore */ }
  });

  function createEgress(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
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

  it('uses custom handlerEntry when provided', () => {
    const { template } = createEgress({
      handlerEntry: tmpHandler,
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          BUS_NAME: Match.anyValue(),
          SERVICE_NAME: 'test-svc',
        }),
      },
    });
  });

  it('omits CUSTOM_EVENT_TYPE_MAP when handlerEntry is provided', () => {
    const { template } = createEgress({
      handlerEntry: tmpHandler,
      customEventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          BUS_NAME: Match.anyValue(),
          SERVICE_NAME: 'test-svc',
        }),
      },
    });
    // Verify CUSTOM_EVENT_TYPE_MAP is NOT present — no Lambda should have it
    const lambdas = template.findResources('AWS::Lambda::Function');
    for (const logicalId of Object.keys(lambdas)) {
      const envVars = lambdas[logicalId]?.Properties?.Environment?.Variables ?? {};
      if (envVars.SERVICE_NAME === 'test-svc') {
        expect(envVars.CUSTOM_EVENT_TYPE_MAP).toBeUndefined();
      }
    }
  });

  it('exposes dlq property', () => {
    const { egress } = createEgress();
    expect(egress.dlq).toBeDefined();
  });
});
