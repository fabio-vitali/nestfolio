import { Duration } from 'aws-cdk-lib';
import {
  Architecture,
  ParamsAndSecretsLayerVersion,
  ParamsAndSecretsVersions,
  Runtime,
  Tracing,
  type ILayerVersion,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

/**
 * Shared bundling + runtime config inherited by every profile.
 * Matches the historical defaults from `defaultLambdaProps` — runtime,
 * architecture, tracing, log retention, and esbuild externals.
 */
export const BASE_LAMBDA_PROPS = {
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.ARM_64,
  tracing: Tracing.ACTIVE,
  logRetention: RetentionDays.THREE_MONTHS,
  bundling: {
    minify: true,
    sourceMap: true,
    target: 'node24',
    externalModules: ['@aws-sdk/*'],
  },
} satisfies Partial<NodejsFunctionProps>;

/**
 * Shared Parameters and Secrets Extension layer used by `adapterProps`.
 * Third-party adapters use this to resolve base URLs from SSM at runtime
 * so integration tests can swap them for mock endpoints without redeploying.
 *
 * Created once at module load and reused across stacks — the layer
 * reference is just a regional ARN, not a CDK construct.
 */
export const PARAMS_AND_SECRETS_LAYER: ILayerVersion = ParamsAndSecretsLayerVersion.fromVersion(
  ParamsAndSecretsVersions.V1_0_103,
  { parameterStoreTtl: Duration.seconds(5) },
);

/**
 * Workload-shaped defaults a service can inherit by passing `profile: X`
 * to `Ingress` or `Egress`. Every field except `lambdaProps` is optional.
 *
 * Precedence at construct level:
 *   explicit construct prop  >  profile default  >  construct hardcoded default
 *
 * - `lambdaProps` — spread into the underlying `NodejsFunction` (memory,
 *   timeout, layers, runtime, …).
 * - `sqsBatchSize` / `sqsMaxBatchingWindow` / `sqsMaxConcurrency` — applied
 *   by `Ingress` to its `SqsEventSource`.
 * - `ddbStreamBatchSize` / `ddbStreamMaxBatchingWindow` /
 *   `ddbStreamParallelizationFactor` — applied by `Egress` to its
 *   `DynamoEventSource`, and also usable directly on standalone
 *   `DynamoEventSource` instances via property access.
 */
export interface LambdaProfile {
  lambdaProps: Partial<NodejsFunctionProps>;
  sqsBatchSize?: number;
  sqsMaxBatchingWindow?: Duration;
  sqsMaxConcurrency?: number;
  ddbStreamBatchSize?: number;
  ddbStreamMaxBatchingWindow?: Duration;
  ddbStreamParallelizationFactor?: number;
}
