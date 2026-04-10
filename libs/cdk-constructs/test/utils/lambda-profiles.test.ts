import { Duration } from 'aws-cdk-lib';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaProfile, handlerProps, adapterProps, reducerProps, PARAMS_AND_SECRETS_LAYER } from '../../src/utils/lambda-profiles';

describe('lambda-profiles — module contract', () => {
  it('exports LambdaProfile type so it can be imported by constructs', () => {
    // Type-level check: if the import fails, TS compile blocks the test.
    const shape: LambdaProfile = {
      lambdaProps: { runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64 },
    };
    expect(shape.lambdaProps).toBeDefined();
  });

  it('LambdaProfile allows optional SQS and DDB stream defaults', () => {
    const full: LambdaProfile = {
      lambdaProps: { memorySize: 256, timeout: Duration.seconds(30), logRetention: RetentionDays.THREE_MONTHS },
      sqsBatchSize: 10,
      sqsMaxBatchingWindow: Duration.seconds(1),
      sqsMaxConcurrency: 5,
      ddbStreamBatchSize: 50,
      ddbStreamMaxBatchingWindow: Duration.seconds(2),
      ddbStreamParallelizationFactor: 1,
    };
    expect(full.sqsBatchSize).toBe(10);
    expect(full.ddbStreamBatchSize).toBe(50);
  });
});

describe('handlerProps — default event handler profile', () => {
  it('uses 256 MB memory (matches current Ingress default)', () => {
    expect(handlerProps.lambdaProps.memorySize).toBe(256);
  });

  it('uses 30s timeout (matches current Ingress default)', () => {
    expect(handlerProps.lambdaProps.timeout).toEqual(Duration.seconds(30));
  });

  it('uses Node.js 24 ARM64 runtime', () => {
    expect(handlerProps.lambdaProps.runtime).toEqual(Runtime.NODEJS_24_X);
    expect(handlerProps.lambdaProps.architecture).toEqual(Architecture.ARM_64);
  });

  it('defaults SQS batch size to 10 (matches current Ingress default)', () => {
    expect(handlerProps.sqsBatchSize).toBe(10);
  });

  it('defaults SQS batching window to 1s (matches current Ingress default)', () => {
    expect(handlerProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(1));
  });

  it('does not set sqsMaxConcurrency (uncapped by default)', () => {
    expect(handlerProps.sqsMaxConcurrency).toBeUndefined();
  });

  it('excludes @aws-sdk/* from bundling', () => {
    expect(handlerProps.lambdaProps.bundling?.externalModules).toEqual(['@aws-sdk/*']);
  });
});

describe('adapterProps — third-party API adapter profile', () => {
  it('uses 256 MB memory (same as handler)', () => {
    expect(adapterProps.lambdaProps.memorySize).toBe(256);
  });

  it('uses 60s timeout (upstream can be slow)', () => {
    expect(adapterProps.lambdaProps.timeout).toEqual(Duration.seconds(60));
  });

  it('bundles the Parameters and Secrets Extension layer', () => {
    expect(adapterProps.lambdaProps.paramsAndSecrets).toBe(PARAMS_AND_SECRETS_LAYER);
  });

  it('uses smaller SQS batches (one slow call cannot hold up unrelated work)', () => {
    expect(adapterProps.sqsBatchSize).toBe(5);
  });

  it('uses 2s SQS batching window', () => {
    expect(adapterProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(2));
  });

  it('caps SQS concurrency to 10 (rate-limit-friendly for third-party APIs)', () => {
    expect(adapterProps.sqsMaxConcurrency).toBe(10);
  });

  it('inherits base bundling config', () => {
    expect(adapterProps.lambdaProps.bundling?.externalModules).toEqual(['@aws-sdk/*']);
  });
});

describe('reducerProps — CDC/stream-heavy reducer profile', () => {
  it('uses 512 MB memory (larger in-memory aggregation)', () => {
    expect(reducerProps.lambdaProps.memorySize).toBe(512);
  });

  it('uses 60s timeout', () => {
    expect(reducerProps.lambdaProps.timeout).toEqual(Duration.seconds(60));
  });

  it('uses large SQS batches (25) to amortize write cost', () => {
    expect(reducerProps.sqsBatchSize).toBe(25);
  });

  it('uses 2s SQS batching window', () => {
    expect(reducerProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(2));
  });

  it('uses DDB stream batch size 100', () => {
    expect(reducerProps.ddbStreamBatchSize).toBe(100);
  });

  it('uses DDB stream batching window 5s', () => {
    expect(reducerProps.ddbStreamMaxBatchingWindow).toEqual(Duration.seconds(5));
  });

  it('uses DDB stream parallelizationFactor 1', () => {
    expect(reducerProps.ddbStreamParallelizationFactor).toBe(1);
  });
});
