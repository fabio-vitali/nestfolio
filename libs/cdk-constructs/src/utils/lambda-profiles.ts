import { Duration } from 'aws-cdk-lib';
import {
  Architecture,
  ParamsAndSecretsLayerVersion,
  ParamsAndSecretsVersions,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Shared bundling + runtime config inherited by every profile.
 * Matches the historical defaults from `defaultLambdaProps` — runtime,
 * architecture, tracing, and esbuild externals.
 *
 * NOTE: log retention is intentionally NOT set here. Functions are created via
 * `ManagedNodejsFunction`, which owns an explicit CFN-managed LogGroup (retention
 * THREE_MONTHS) so the group shares the function lifecycle and is cleaned up by
 * the non-prod auto-delete Aspect. `logGroup` + `logRetention` are mutually
 * exclusive in CDK.
 */
export const BASE_LAMBDA_PROPS = {
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.ARM_64,
  tracing: Tracing.ACTIVE,
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
export const PARAMS_AND_SECRETS_LAYER: ParamsAndSecretsLayerVersion = ParamsAndSecretsLayerVersion.fromVersion(
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
 * - `visibilityTimeout` — applied by `Ingress` to its SQS Queue. When unset,
 *   `Ingress` auto-calculates `6 × lambdaTimeout`.
 */
export interface LambdaProfile {
  lambdaProps: Partial<NodejsFunctionProps>;
  sqsBatchSize?: number;
  sqsMaxBatchingWindow?: Duration;
  sqsMaxConcurrency?: number;
  visibilityTimeout?: Duration;
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
    bundling: {
      ...BASE_LAMBDA_PROPS.bundling,
      // Bundle every @aws-sdk/* package — DO NOT externalize. The Node 24
      // Lambda runtime ships an older snapshot of the AWS SDK; agent
      // Lambdas use `@nestfolio/agent-orchestrator` which calls the
      // recently-added `BatchCreateMemoryRecordsCommand` from
      // `@aws-sdk/client-bedrock-agentcore` (added ~v3.1xxx). The runtime
      // SDK exports `BedrockAgentCoreClient` + `RetrieveMemoryRecordsCommand`
      // + `ListMemoryRecordsCommand` but NOT `BatchCreateMemoryRecordsCommand`,
      // producing `TypeError: <ns>.BatchCreateMemoryRecordsCommand is not a
      // constructor` at agent-side memory writes. Bundling locally pins the
      // version we actually depend on (`^3.1012.0` per agent-orchestrator's
      // package.json). Other profiles keep `['@aws-sdk/*']` because their
      // Lambdas only call SDK clients that have been in the runtime since
      // Node 18 (dynamodb, lib-dynamodb, eventbridge, sfn).
      externalModules: [],
    },
  },
  sqsBatchSize: 1,
  sqsMaxBatchingWindow: Duration.seconds(0),
  sqsMaxConcurrency: 5,
};

/**
 * Inputs to {@link agentProfile} — three meaningful, defensible numbers
 * the author can derive from CloudWatch evidence.
 *
 * The helper derives `(lambdaTimeout, sqsMaxConcurrency, visibilityTimeout)`
 * from these and asserts the invariant
 *
 *     visibilityTimeoutSec ≤ uxBudgetSeconds × 2
 *
 * at synth time, so the three knobs cannot drift apart silently.
 *
 * See `docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md`
 * for the full derivation + rationale.
 */
export interface AgentProfileInputs {
  /** P90 latency of the agent invocation, in milliseconds. Plan around the slow tail. */
  agentLatencyP90Ms: number;
  /** Max simultaneous messages the queue may hold from realistic fan-out. Size for 2× observed peak. */
  expectedBurstSize: number;
  /** Time the SF state can spend before the user perceives the decision as failed. Must match the SF's TimeoutSeconds for this agent. */
  uxBudgetSeconds: number;
  /** SQS retries allowed within the visibility window. Default 4 (the CDK 6× default would violate the invariant for typical (p90, ux) shapes). */
  visibilityMultiplier?: number;
  /** Bundling escape hatch — defaults to externalModules=[] (PE+AN bundle @aws-sdk/* — see agentProps note). */
  bundling?: NodejsFunctionProps['bundling'];
}

/**
 * Deadline-bound Bedrock/LLM-calling Lambda profile. The hidden three-knob
 * agreement between SF `TimeoutSeconds`, SQS `visibilityTimeout`, and Lambda
 * `sqsMaxConcurrency` becomes an explicit, checked invariant.
 *
 * Use for: any Lambda whose execution time directly determines whether an
 * upstream SF task token is honoured — today, portfolio-engine-ctrl and
 * advisory-narrative-ctrl. NOT for continuous projection writers (those keep
 * using `agentProps`).
 *
 * @throws when `visibilityTimeoutSec > uxBudgetSeconds × 2` — drop the
 *   `visibilityMultiplier` or raise `uxBudgetSeconds`.
 */
export function agentProfile(inputs: AgentProfileInputs): LambdaProfile {
  if (inputs.agentLatencyP90Ms <= 0) throw new Error('agentProfile: agentLatencyP90Ms must be > 0');
  if (inputs.expectedBurstSize <= 0) throw new Error('agentProfile: expectedBurstSize must be > 0');
  if (inputs.uxBudgetSeconds <= 0) throw new Error('agentProfile: uxBudgetSeconds must be > 0');
  const visibilityMultiplier = inputs.visibilityMultiplier ?? 4;
  if (visibilityMultiplier < 1) throw new Error('agentProfile: visibilityMultiplier must be >= 1');

  const p90Sec = inputs.agentLatencyP90Ms / 1000;
  const lambdaTimeoutSec = Math.ceil(p90Sec * 1.5) + 5;
  const sqsMaxConcurrency = Math.max(
    1,
    Math.ceil(inputs.expectedBurstSize * p90Sec / inputs.uxBudgetSeconds),
  );
  const visibilitySec = lambdaTimeoutSec * visibilityMultiplier;

  if (visibilitySec > inputs.uxBudgetSeconds * 2) {
    throw new Error(
      `agentProfile invariant violated: visibilityTimeoutSec=${visibilitySec} > uxBudgetSeconds×2=${inputs.uxBudgetSeconds * 2}. ` +
      `Lower visibilityMultiplier (currently ${visibilityMultiplier}) or raise uxBudgetSeconds (currently ${inputs.uxBudgetSeconds}).`,
    );
  }

  return {
    lambdaProps: {
      ...BASE_LAMBDA_PROPS,
      memorySize: 1024,
      timeout: Duration.seconds(lambdaTimeoutSec),
      bundling: inputs.bundling ?? {
        ...BASE_LAMBDA_PROPS.bundling,
        // Bundle every @aws-sdk/* package — DO NOT externalize. The Node 24
        // Lambda runtime ships an older snapshot of the AWS SDK; agent
        // Lambdas use `@nestfolio/agent-orchestrator` which calls the
        // recently-added `BatchCreateMemoryRecordsCommand` from
        // `@aws-sdk/client-bedrock-agentcore`. Externalizing produces
        // `TypeError: <ns>.BatchCreateMemoryRecordsCommand is not a constructor`.
        externalModules: [],
      },
    },
    sqsBatchSize: 1,
    sqsMaxBatchingWindow: Duration.seconds(0),
    sqsMaxConcurrency,
    visibilityTimeout: Duration.seconds(visibilitySec),
  };
}
