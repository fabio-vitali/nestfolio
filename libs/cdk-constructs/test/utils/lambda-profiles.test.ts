import { Duration } from 'aws-cdk-lib';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaProfile } from '../../src/utils/lambda-profiles';

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
