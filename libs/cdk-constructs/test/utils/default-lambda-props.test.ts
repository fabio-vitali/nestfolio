import { App, Stack, Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
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

  it('sets 90-day log retention', () => {
    const props = defaultLambdaProps(stack);
    expect(props.logRetention).toBe(RetentionDays.THREE_MONTHS);
  });
});
