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

/**
 * Default profile for event-processor Lambdas running business logic on
 * EventBridge → SQS messages. Values match the historical Ingress defaults
 * exactly, so services with no explicit profile are 100% backwards-compatible.
 *
 * Use for: most `-ctrl` services, internal handlers, anything without a
 * more specialized workload shape.
 */
export const handlerProps: LambdaProfile = {
  lambdaProps: {
    ...BASE_LAMBDA_PROPS,
    memorySize: 256,
    timeout: Duration.seconds(30),
  },
  sqsBatchSize: 10,
  sqsMaxBatchingWindow: Duration.seconds(1),
};

/**
 * Profile for THIRD-PARTY adapters — Lambdas that call external HTTP APIs.
 *
 * Bundles the AWS Parameters and Secrets Extension layer so base URLs can
 * be swapped at runtime via SSM for integration tests. Smaller SQS batches
 * so a slow upstream request doesn't hold up unrelated work (partial
 * failures are already handled by `reportBatchItemFailures`). Concurrency
 * capped below typical third-party rate limits.
 *
 * Use for:
 *   - fred-adpt, marketwatch-adpt, alpha-vantage-adpt, yahoo-finance-adpt,
 *     sec-edgar-adpt (advisory domain data feeds)
 *   - broker-alpaca-adpt (execution domain broker API wrapper)
 *
 * Do NOT use for:
 *   - Internal cross-domain adapters (investor-adpt, advisory-adpt,
 *     execution-adpt, ledger-adpt) — those have no Lambda, they are pure
 *     EB Rule → EB Target forwarding.
 *   - broker-sim-adpt — a local simulator, not a real third-party wrapper.
 */
export const adapterProps: LambdaProfile = {
  lambdaProps: {
    ...BASE_LAMBDA_PROPS,
    memorySize: 256,
    timeout: Duration.seconds(60),
    paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
  },
  sqsBatchSize: 5,
  sqsMaxBatchingWindow: Duration.seconds(2),
  sqsMaxConcurrency: 10,
};

/**
 * Profile for high-throughput CDC reducers and projection builders —
 * Lambdas that consume a DynamoDB stream (or a large SQS fan-out) to
 * materialize read models. Larger memory for in-memory aggregation,
 * larger DDB batches to amortize write cost, conservative
 * parallelization factor so batches stay ordered within a partition.
 *
 * Use for:
 *   - ledger-ctrl ReducerFn (materializes account snapshots from
 *     LedgerEntry events)
 *   - future projection builders
 */
export const reducerProps: LambdaProfile = {
  lambdaProps: {
    ...BASE_LAMBDA_PROPS,
    memorySize: 512,
    timeout: Duration.seconds(60),
  },
  sqsBatchSize: 25,
  sqsMaxBatchingWindow: Duration.seconds(2),
  ddbStreamBatchSize: 100,
  ddbStreamMaxBatchingWindow: Duration.seconds(5),
  ddbStreamParallelizationFactor: 1,
};

/**
 * Profile for Bedrock/LLM-calling Lambdas — agent orchestrators whose
 * main workload is long-running model invocation.
 *
 * - High memory (matters for cold-start with bundled LangGraph/CopilotKit)
 * - Long timeout (model invocations routinely run 30s–5min)
 * - One event = one invocation (batching is meaningless when each call
 *   is multi-second)
 * - Concurrency capped below typical Bedrock TPS limits to avoid
 *   throttle → retry → DLQ storms
 *
 * Use for:
 *   - investor-profile-ctrl Ingress (ANALYZE_INVESTOR_PROFILE)
 *   - portfolio-engine-ctrl Ingress (CONSTRUCT_PORTFOLIO)
 *   - future agent orchestrator services
 */
export const agentProps: LambdaProfile = {
  lambdaProps: {
    ...BASE_LAMBDA_PROPS,
    memorySize: 1024,
    timeout: Duration.minutes(5),
  },
  sqsBatchSize: 1,
  sqsMaxBatchingWindow: Duration.seconds(0),
  sqsMaxConcurrency: 5,
};
