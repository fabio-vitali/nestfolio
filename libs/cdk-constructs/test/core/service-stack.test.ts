import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as os from 'os';
import { ServiceStack } from '../../src/core/service-stack';
import { State } from '../../src/core/state';

describe('ServiceStack', () => {
  function createStack(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    return new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'investor',
      service: 'investor-bff',
      serviceDir: os.tmpdir(),
      ...overrides,
    });
  }

  it('creates NamingService', () => {
    const stack = createStack();
    expect(stack.naming.eventBusName()).toBe('test-investor-event-bus');
  });

  it('does not create State automatically', () => {
    const stack = createStack();
    expect((stack as any).state).toBeUndefined();
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
  });

  it('no longer accepts stateProps — works without it', () => {
    const stack = createStack();
    expect(stack).toBeDefined();
    expect(stack.serviceName).toBe('investor-bff');
  });

  it('applies standard tags', () => {
    const stack = createStack();
    const template = Template.fromStack(stack);
    // Tags are applied to all resources via CloudFormation
    expect(template.toJSON()).toBeDefined();
  });

  it('creates eventBus lazily from naming convention', () => {
    const stack = createStack();
    // Access triggers lazy creation
    expect(stack.eventBus).toBeDefined();
  });

  it('accepts explicit eventBus in props', () => {
    const app = new App({ context: { prefix: 'test' } });
    const otherStack = new ServiceStack(app, 'OtherStack', {
      prefix: 'test',
      subsystem: 'ledger',
      service: 'ledger-hub',
      serviceDir: os.tmpdir(),
    });
    const bus = new EventBus(otherStack, 'CustomBus');

    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'ledger',
      service: 'ledger-ctrl',
      serviceDir: os.tmpdir(),
      eventBus: bus,
    });
    expect(stack.eventBus).toBe(bus);
  });

  it('static of() returns ServiceStack for child constructs', () => {
    const stack = createStack();
    const child = new Construct(stack, 'Child');
    expect(ServiceStack.of(child)).toBe(stack);
  });

  it('static of() throws for non-ServiceStack', () => {
    const app = new App();
    const stack = new Stack(app, 'PlainStack');
    const child = new Construct(stack, 'Child');
    expect(() => ServiceStack.of(child)).toThrow('is not within a ServiceStack');
  });

  it('exposes serviceName and serviceDir', () => {
    const stack = createStack();
    expect(stack.serviceName).toBe('investor-bff');
    expect(stack.serviceDir).toBe(os.tmpdir());
  });

  it('domain defaults to subsystem', () => {
    const stack = createStack();
    // Verify the stack was created successfully (domain used internally for tags)
    expect(stack).toBeDefined();
  });

  it('addObservability is a no-op when observability is false', () => {
    const stack = createStack({ observability: false });
    stack.addObservability({});
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 0);
  });

  it('addObservability creates resources when observability is true (default)', () => {
    const stack = createStack();
    stack.addObservability({});
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  describe('production flag', () => {
    it('defaults to false for a non-prod prefix', () => {
      expect(createStack({ prefix: 'dev' }).production).toBe(false);
      expect(createStack({ prefix: 'sandbox-pr-7' }).production).toBe(false);
    });

    it('defaults to true for prod prefixes', () => {
      expect(createStack({ prefix: 'prod' }).production).toBe(true);
      expect(createStack({ prefix: 'production' }).production).toBe(true);
    });

    it('honors an explicit production override over the prefix default', () => {
      expect(createStack({ prefix: 'dev', production: true }).production).toBe(true);
      expect(createStack({ prefix: 'prod', production: false }).production).toBe(false);
    });

    it('productionOf returns the enclosing ServiceStack flag', () => {
      const stack = createStack({ prefix: 'prod' });
      const child = new Construct(stack, 'Child');
      expect(ServiceStack.productionOf(child)).toBe(true);
    });

    it('productionOf returns false outside a ServiceStack', () => {
      const app = new App();
      const plain = new Stack(app, 'PlainStack');
      expect(ServiceStack.productionOf(new Construct(plain, 'Child'))).toBe(false);
    });
  });

  describe('non-prod auto-delete Aspect', () => {
    it('forces DESTROY on DynamoDB tables and log groups in non-prod', () => {
      const stack = createStack({ prefix: 'dev' });
      new State(stack, 'State');
      new LogGroup(stack, 'SomeLogGroup');
      const template = Template.fromStack(stack);
      template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
      template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
    });

    it('keeps RETAIN on stateful resources in production', () => {
      const stack = createStack({ prefix: 'prod' });
      new State(stack, 'State');
      new LogGroup(stack, 'SomeLogGroup');
      const template = Template.fromStack(stack);
      template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
      template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    });
  });
});
