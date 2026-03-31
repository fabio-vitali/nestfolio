import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceStack } from '../../src/core/service-stack';
import { State } from '../../src/core/state';
import { Egress } from '../../src/core/egress';

describe('Egress construct', () => {
  const handlersDir = path.join(os.tmpdir(), 'handlers');
  const defaultHandler = path.join(handlersDir, 'event-publisher.ts');

  beforeAll(() => {
    fs.mkdirSync(handlersDir, { recursive: true });
    fs.writeFileSync(defaultHandler, 'export const handler = async () => {};');
  });

  afterAll(() => {
    try { fs.unlinkSync(defaultHandler); } catch { /* ignore */ }
  });

  function createEgress(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
    });

    const withTable = (overrides['withTable'] as boolean) ?? true;
    const withBucket = (overrides['withBucket'] as boolean) ?? false;
    const state = new State(stack, 'State', { withTable, withBucket });

    const egress = new Egress(stack, 'TestEgress', {
      state,
      eventTypes: { 'Order': 'ORDER', 'StagedOrder': 'STAGED_ORDER' },
      ...(overrides['egressOverrides'] as Record<string, unknown> ?? {}),
    });

    return { stack, state, egress, template: Template.fromStack(stack) };
  }

  describe('Lambda creation', () => {
    it('creates publisher Lambda with SERVICE_NAME and BUS_NAME', () => {
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

    it('sets EVENT_TYPE_MAP env var with serialized config', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            EVENT_TYPE_MAP: JSON.stringify({
              'Order:INSERT': 'ORDER_CREATED',
              'Order:MODIFY': 'ORDER_UPDATED',
              'StagedOrder:INSERT': 'STAGED_ORDER_CREATED',
              'StagedOrder:MODIFY': 'STAGED_ORDER_UPDATED',
            }),
          }),
        },
      });
    });

    it('sets TABLE_NAME when state has a table', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }),
        },
      });
    });

    it('sets BUCKET_NAME when state has a bucket', () => {
      const { template } = createEgress({ withBucket: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ BUCKET_NAME: Match.anyValue() }),
        },
      });
    });

    it('merges extra environment variables', () => {
      const { template } = createEgress({
        egressOverrides: { environment: { CUSTOM_VAR: 'custom-value' } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ CUSTOM_VAR: 'custom-value' }),
        },
      });
    });

    it('applies lambdaProps overrides', () => {
      const { template } = createEgress({
        egressOverrides: { lambdaProps: { memorySize: 512 } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('exposes handler property', () => {
      const { egress } = createEgress();
      expect(egress.handler).toBeDefined();
    });
  });

  describe('allEventTypes()', () => {
    it('returns expanded event types for base names', () => {
      const { egress } = createEgress();
      expect(egress.allEventTypes()).toEqual(expect.arrayContaining([
        'ORDER_CREATED', 'ORDER_UPDATED',
        'STAGED_ORDER_CREATED', 'STAGED_ORDER_UPDATED',
      ]));
    });

    it('returns explicit event types for per-action config', () => {
      const { egress } = createEgress({
        egressOverrides: {
          eventTypes: { 'Payment': { insert: 'PAYMENT_RECEIVED' } },
        },
      });
      expect(egress.allEventTypes()).toEqual(['PAYMENT_RECEIVED']);
    });
  });

  describe('IAM grants', () => {
    it('grants DynamoDB read/write when state has table', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['dynamodb:BatchGetItem']),
            }),
          ]),
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
  });

  describe('DynamoDB Streams config', () => {
    it('creates DLQ with 14-day retention', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600,
      });
    });

    it('exposes dlq property', () => {
      const { egress } = createEgress();
      expect(egress.dlq).toBeDefined();
    });

    it('uses custom retryAttempts', () => {
      const { template } = createEgress({
        egressOverrides: { retryAttempts: 5 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumRetryAttempts: 5,
      });
    });

    it('defaults retryAttempts to 3', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumRetryAttempts: 3,
      });
    });

    it('uses custom batchSize', () => {
      const { template } = createEgress({
        egressOverrides: { batchSize: 50 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 50,
      });
    });
  });
});
