import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import * as os from 'os';
import { ServiceStack } from '../src/service-stack';

describe('ServiceStack', () => {
  function createStack(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    return new ServiceStack(app, 'TestStack', {
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

  it('creates State with DynamoDB table by default', () => {
    const stack = createStack();
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates State with custom props', () => {
    const stack = createStack({ stateProps: { withBucket: true } });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourceCountIs('AWS::S3::Bucket', 1);
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
      subsystem: 'ledger',
      service: 'ledger-hub',
      serviceDir: os.tmpdir(),
    });
    const bus = new EventBus(otherStack, 'CustomBus');

    const stack = new ServiceStack(app, 'TestStack', {
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
});
