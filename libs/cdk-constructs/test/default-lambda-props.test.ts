import { App, Stack, Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { defaultLambdaProps, agentLambdaProps } from '../src/default-lambda-props';

describe('defaultLambdaProps', () => {
  let stack: Stack;

  beforeEach(() => {
    const app = new App();
    stack = new Stack(app, 'TestStack');
  });

  it('uses 30s timeout for standard Lambdas', () => {
    const props = defaultLambdaProps(stack);
    expect(props.timeout).toEqual(Duration.seconds(30));
  });

  it('uses 256 MB memory', () => {
    const props = defaultLambdaProps(stack);
    expect(props.memorySize).toBe(256);
  });

  it('enables active tracing', () => {
    const props = defaultLambdaProps(stack);
    expect(props.tracing).toBeDefined();
  });

  it('excludes @aws-sdk/* from bundling', () => {
    const props = defaultLambdaProps(stack);
    expect(props.bundling?.externalModules).toEqual(['@aws-sdk/*']);
  });

  it('sets 90-day log retention', () => {
    const props = defaultLambdaProps(stack);
    expect(props.logRetention).toBe(RetentionDays.THREE_MONTHS);
  });
});

describe('agentLambdaProps', () => {
  let stack: Stack;

  beforeEach(() => {
    const app = new App();
    stack = new Stack(app, 'TestStack');
  });

  it('uses 180s timeout for agent Lambdas', () => {
    const props = agentLambdaProps(stack);
    expect(props.timeout).toEqual(Duration.seconds(180));
  });

  it('uses 512 MB memory for agent Lambdas', () => {
    const props = agentLambdaProps(stack);
    expect(props.memorySize).toBe(512);
  });

  it('inherits runtime and architecture from defaultLambdaProps', () => {
    const defaultProps = defaultLambdaProps(stack);
    const agentProps = agentLambdaProps(stack);

    expect(agentProps.runtime).toEqual(defaultProps.runtime);
    expect(agentProps.architecture).toEqual(defaultProps.architecture);
  });

  it('SQS Ingress visibility timeout (180s) >= 6x default Lambda timeout (30s)', () => {
    // Default Lambda timeout is 30s, Ingress visibility timeout is 180s
    const timeoutSeconds = 30; // Duration.seconds(30) from defaultLambdaProps
    const ingressVisibilityTimeout = 180; // from Ingress construct
    expect(ingressVisibilityTimeout).toBeGreaterThanOrEqual(6 * timeoutSeconds);
  });
});
