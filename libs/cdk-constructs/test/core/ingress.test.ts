import { App, Duration } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Ingress } from '../../src/core/ingress';
import { ServiceStack } from '../../src/core/service-stack';

describe('Ingress construct', () => {
  const handlerPath = path.join(os.tmpdir(), 'ingress-test-handler.ts');

  beforeAll(() => {
    fs.writeFileSync(handlerPath, 'export const handler = async () => ({});');
  });

  afterAll(() => {
    fs.unlinkSync(handlerPath);
  });

  function createIngress(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
      stateProps: {
        withBucket: (overrides['withBucket'] as boolean) ?? false,
        withTable: (overrides['withTable'] as boolean) ?? true,
      },
    });

    const ingress = new Ingress(stack, 'TestIngress', {
      eventTypes: ['TestEvent'],
      entry: handlerPath,
      ...(overrides['ingressOverrides'] as Record<string, unknown> ?? {}),
    });

    return { stack, state: stack.state, ingress, template: Template.fromStack(stack) };
  }

  describe('Lambda creation', () => {
    it('creates a NodejsFunction with SERVICE_NAME and BUS_NAME env vars', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            SERVICE_NAME: 'test-svc',
            BUS_NAME: Match.anyValue(),
          }),
        },
      });
    });

    it('sets TABLE_NAME when state has a table', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }),
        },
      });
    });

    it('sets BUCKET_NAME when state has a bucket', () => {
      const { template } = createIngress({ withBucket: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ BUCKET_NAME: Match.anyValue() }),
        },
      });
    });

    it('sets both TABLE_NAME and BUCKET_NAME when state has both', () => {
      const { template } = createIngress({ withBucket: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: Match.anyValue(),
            BUCKET_NAME: Match.anyValue(),
          }),
        },
      });
    });

    it('omits TABLE_NAME when state has no table', () => {
      const { template } = createIngress({ withTable: false, withBucket: true });
      // Should NOT have TABLE_NAME
      const fns = template.findResources('AWS::Lambda::Function');
      const fnKey = Object.keys(fns).find(k =>
        fns[k].Properties?.Environment?.Variables?.SERVICE_NAME === 'test-svc',
      );
      expect(fnKey).toBeDefined();
      expect(fns[fnKey!].Properties.Environment.Variables.TABLE_NAME).toBeUndefined();
    });

    it('merges extra environment variables', () => {
      const { template } = createIngress({
        ingressOverrides: { environment: { CUSTOM_VAR: 'custom-value' } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ CUSTOM_VAR: 'custom-value' }),
        },
      });
    });

    it('applies lambdaProps overrides', () => {
      const { template } = createIngress({
        ingressOverrides: { lambdaProps: { memorySize: 512 } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('exposes handler property', () => {
      const { ingress } = createIngress();
      expect(ingress.handler).toBeDefined();
    });
  });

  describe('IAM grants', () => {
    it('grants DynamoDB read/write when state has table', () => {
      const { template } = createIngress();
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
      const { template } = createIngress();
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

  describe('SQS config', () => {
    it('applies custom batchSize and maxRetries', () => {
      const { template } = createIngress({
        ingressOverrides: { batchSize: 5, maxRetries: 2 },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: { maxReceiveCount: 2 },
      });
    });

    it('auto-calculates visibilityTimeout from lambdaTimeout (6x)', () => {
      const { template } = createIngress({
        ingressOverrides: { lambdaTimeout: Duration.seconds(30) },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 180,
      });
    });

    it('explicit visibilityTimeout takes precedence over lambdaTimeout', () => {
      const { template } = createIngress({
        ingressOverrides: {
          lambdaTimeout: Duration.seconds(30),
          visibilityTimeout: Duration.seconds(60),
        },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 60,
      });
    });
  });
});
