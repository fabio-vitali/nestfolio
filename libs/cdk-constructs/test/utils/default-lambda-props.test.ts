import { App, Stack, Duration } from 'aws-cdk-lib';
import { defaultLambdaProps } from '../../src/utils/default-lambda-props';

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

  it('does NOT set logRetention (log groups are owned by ManagedNodejsFunction)', () => {
    const props = defaultLambdaProps(stack);
    // logRetention is mutually exclusive with the explicit, CFN-managed LogGroup
    // that ManagedNodejsFunction attaches; retention lives on that LogGroup now.
    expect(props.logRetention).toBeUndefined();
  });
});
