import { App, Duration } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Ingress } from '../../src/core/ingress';
import { ServiceStack } from '../../src/core/service-stack';
import { State } from '../../src/core/state';
import { adapterProps, agentProps } from '../../src/utils/lambda-profiles';

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
    });

    const withTable = (overrides['withTable'] as boolean) ?? true;
    const withBucket = (overrides['withBucket'] as boolean) ?? false;
    const noState = overrides['noState'] as boolean ?? false;
    const state = noState ? undefined : new State(stack, 'State', { withTable, withBucket });

    const ingress = new Ingress(stack, 'TestIngress', {
      eventTypes: ['TestEvent'],
      entry: handlerPath,
      state,
      ...(overrides['ingressOverrides'] as Record<string, unknown> ?? {}),
    });

    return { stack, state, ingress, template: Template.fromStack(stack) };
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

    it('works without state (stateless adapter pattern)', () => {
      const { template } = createIngress({ noState: true });
      // Should have SERVICE_NAME but no TABLE_NAME
      const fns = template.findResources('AWS::Lambda::Function');
      const fnKey = Object.keys(fns).find(k =>
        fns[k].Properties?.Environment?.Variables?.SERVICE_NAME === 'test-svc',
      );
      expect(fnKey).toBeDefined();
      expect(fns[fnKey!].Properties.Environment.Variables.TABLE_NAME).toBeUndefined();
      expect(fns[fnKey!].Properties.Environment.Variables.BUCKET_NAME).toBeUndefined();
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

    it('does not set maxConcurrency by default', () => {
      const { template } = createIngress();
      const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
      const sqsMapping = Object.values(mappings).find(
        (m) => m.Properties?.EventSourceArn?.['Fn::GetAtt']?.[0]?.startsWith('TestIngressQueue'),
      );
      expect(sqsMapping).toBeDefined();
      expect(sqsMapping!.Properties.ScalingConfig).toBeUndefined();
    });

    it('applies explicit maxConcurrency to the SQS event source', () => {
      const { template } = createIngress({
        ingressOverrides: { maxConcurrency: 7 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 7 },
      });
    });
  });

  describe('LambdaProfile integration', () => {
    it('applies profile lambdaProps to the handler (agentProps: 1024 MB, 5min timeout)', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 1024,
        Timeout: 300,
      });
    });

    it('applies profile sqsBatchSize to the event source', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 1,
      });
    });

    it('applies profile sqsMaxConcurrency to the event source', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 5 },
      });
    });

    it('explicit batchSize overrides profile sqsBatchSize', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps, batchSize: 3 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 3,
      });
    });

    it('explicit lambdaProps overrides profile lambdaProps', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: agentProps,
          lambdaProps: { memorySize: 2048 },
        },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 2048,
        Timeout: 300,
      });
    });

    it('explicit lambdaTimeout overrides profile timeout AND drives visibility timeout', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: agentProps,
          lambdaTimeout: Duration.seconds(60),
        },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60,
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 360,
      });
    });

    it('explicit maxConcurrency overrides profile sqsMaxConcurrency', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps, maxConcurrency: 2 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 2 },
      });
    });

    it('no profile — behavior identical to current defaults (256 MB, 30s, batch 10)', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 256,
        Timeout: 30,
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 10,
      });
    });

    it('adapterProps profile bundles paramsAndSecrets layer on the Lambda', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: adapterProps },
      });
      // The Params and Secrets Extension attaches a Layers array on the handler Lambda.
      const fns = template.findResources('AWS::Lambda::Function');
      const handlerFn = Object.values(fns).find(
        (f) => f.Properties?.Environment?.Variables?.SERVICE_NAME === 'test-svc',
      );
      expect(handlerFn).toBeDefined();
      expect(Array.isArray(handlerFn!.Properties.Layers)).toBe(true);
      expect(handlerFn!.Properties.Layers.length).toBeGreaterThan(0);
    });
  });

  describe('reservedConcurrency prop', () => {
    it('passes reservedConcurrency prop through to the underlying Lambda', () => {
      const { template } = createIngress({
        ingressOverrides: { reservedConcurrency: 1 },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        ReservedConcurrentExecutions: 1,
      });
    });

    it('does not set ReservedConcurrentExecutions when reservedConcurrency is not passed', () => {
      const { template } = createIngress();
      const fns = template.findResources('AWS::Lambda::Function');
      const fnKey = Object.keys(fns).find(
        (k) => fns[k].Properties?.Environment?.Variables?.SERVICE_NAME === 'test-svc',
      );
      expect(fnKey).toBeDefined();
      expect(fns[fnKey!].Properties.ReservedConcurrentExecutions).toBeUndefined();
    });
  });

  describe('profile.visibilityTimeout fallback', () => {
    it('uses profile.visibilityTimeout when explicit prop is absent', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: {
            lambdaProps: { timeout: Duration.seconds(60) },
            visibilityTimeout: Duration.seconds(240),
          },
        },
      });
      template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 240 });
    });

    it('falls back to 6× lambdaTimeout when neither explicit prop nor profile sets visibility', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: {
            lambdaProps: { timeout: Duration.seconds(30) },
          },
        },
      });
      template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 180 });
    });

    it('explicit visibilityTimeout takes precedence over profile.visibilityTimeout', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: {
            lambdaProps: { timeout: Duration.seconds(60) },
            visibilityTimeout: Duration.seconds(240),
          },
          visibilityTimeout: Duration.seconds(120),
        },
      });
      template.hasResourceProperties('AWS::SQS::Queue', { VisibilityTimeout: 120 });
    });
  });
});
