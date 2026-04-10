# Lambda Profile System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc Lambda memory/timeout/batch tuning across 33 services with 4 named workload profiles (`handlerProps`, `adapterProps`, `reducerProps`, `agentProps`), wire them through the `Ingress` and `Egress` constructs as opt-in defaults, and migrate every service that needs non-default tuning.

**Architecture:** The profiles are plain `LambdaProfile` objects in `libs/cdk-constructs/src/utils/lambda-profiles.ts`. Each profile bundles `lambdaProps` (memory/timeout/layers) **plus** event-source defaults (SQS `batchSize`/`maxBatchingWindow`/`maxConcurrency`, DDB Stream `batchSize`/`maxBatchingWindow`/`parallelizationFactor`). `Ingress` and `Egress` constructs accept an optional `profile?: LambdaProfile`; the precedence chain is **explicit construct prop → profile default → construct hardcoded default**, preserving all existing behavior when no profile is passed. Zero risk to services that don't opt in. The `adapterProps` profile bakes in the AWS Parameters and Secrets Extension layer, killing the `paramsAndSecrets` boilerplate duplicated across 6 third-party adapter stacks.

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib`), TypeScript, Jest, Nx, `@aws-sdk/*` externalized via esbuild bundling.

---

## Scope — Services Affected

**Library changes:** `libs/cdk-constructs` only.

**Third-party adapters migrated to `adapterProps`** (7 services):
- `services/advisory/fred-adpt` (preserves `lambdaTimeout: 90s`)
- `services/advisory/marketwatch-adpt` (preserves `lambdaTimeout: 60s`)
- `services/advisory/alpha-vantage-adpt` (preserves `lambdaTimeout: 90s`)
- `services/advisory/yahoo-finance-adpt` (preserves `lambdaTimeout: 60s`)
- `services/advisory/sec-edgar-adpt` (preserves `memorySize: 512` and `lambdaTimeout: 120s`)
- `services/execution/broker-alpaca-adpt` (Ingress + 2 standalone poll Lambdas)

**Reducer migrated to `reducerProps`** (1 service):
- `services/ledger/ledger-ctrl` standalone `ReducerFn`

**Agent services migrated to `agentProps`** (2 services):
- `services/advisory/investor-profile-ctrl` Ingress (LLM consumer)
- `services/advisory/portfolio-engine-ctrl` Ingress (LLM consumer)

**NOT migrated — intentionally:**
- `services/execution/broker-sim-adpt` — despite the `-adpt` suffix, this is a local simulator that does NOT call external APIs and does NOT use `paramsAndSecrets`. Stays on default (`handlerProps`-shape).
- Internal cross-domain adapters (`investor-adpt`, `advisory-adpt`, `execution-adpt`, `ledger-adpt`) — have **no Lambda at all**; they are pure EB Rule → EB Target forwarding, so there is nothing to tune.
- KB ingestion and tool Lambdas in agent services (`KBIngestion`, `PortfolioLookup`) — keep on `defaultLambdaProps`; they are not the LLM path.

---

## File Structure

**Created:**
- `libs/cdk-constructs/src/utils/lambda-profiles.ts` — the `LambdaProfile` interface and the 4 profile constants
- `libs/cdk-constructs/test/utils/lambda-profiles.test.ts` — unit tests for each profile's values and the shared params-and-secrets layer

**Modified (library):**
- `libs/cdk-constructs/src/utils/index.ts` — export the new profiles + `LambdaProfile` type; remove `agentLambdaProps` from the re-export
- `libs/cdk-constructs/src/utils/default-lambda-props.ts` — delete the unused `agentLambdaProps` helper (superseded by `agentProps`)
- `libs/cdk-constructs/test/utils/default-lambda-props.test.ts` — remove the `agentLambdaProps` test block
- `libs/cdk-constructs/src/core/ingress.ts` — add `profile?` and `maxConcurrency?` props; apply profile defaults with correct precedence
- `libs/cdk-constructs/test/core/ingress.test.ts` — add tests for `maxConcurrency` and `profile` precedence
- `libs/cdk-constructs/src/core/egress.ts` — add `profile?`, `maxBatchingWindow?`, `parallelizationFactor?` props; apply profile defaults
- `libs/cdk-constructs/test/core/egress.test.ts` — add tests for the new props and `profile` precedence

**Modified (services — one commit per service):**
- `services/advisory/fred-adpt/src/service.stack.ts`
- `services/advisory/marketwatch-adpt/src/service.stack.ts`
- `services/advisory/alpha-vantage-adpt/src/service.stack.ts`
- `services/advisory/yahoo-finance-adpt/src/service.stack.ts`
- `services/advisory/sec-edgar-adpt/src/service.stack.ts`
- `services/execution/broker-alpaca-adpt/src/service.stack.ts`
- `services/ledger/ledger-ctrl/src/service.stack.ts`
- `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`

---

## Phase A — Profile System Foundation

The goal of Phase A is to land the `LambdaProfile` interface and all four profile constants as pure additive changes. After Phase A the library exports new symbols but nothing consumes them yet.

### Task A1: Scaffold `lambda-profiles.ts` with interface + base props

**Files:**
- Create: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Test: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL with `Cannot find module '../../src/utils/lambda-profiles'`.

- [ ] **Step 3: Create `lambda-profiles.ts` with the interface and shared base constants**

Create `libs/cdk-constructs/src/utils/lambda-profiles.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts \
        libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): scaffold LambdaProfile interface and base constants"
```

---

### Task A2: Add `handlerProps` profile

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Modify: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
import { handlerProps } from '../../src/utils/lambda-profiles';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL with `has no exported member 'handlerProps'`.

- [ ] **Step 3: Add the `handlerProps` export**

Append to `libs/cdk-constructs/src/utils/lambda-profiles.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 9 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts \
        libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add handlerProps default profile"
```

---

### Task A3: Add `adapterProps` profile

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Modify: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
import { adapterProps, PARAMS_AND_SECRETS_LAYER } from '../../src/utils/lambda-profiles';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL with `has no exported member 'adapterProps'`.

- [ ] **Step 3: Add the `adapterProps` export**

Append to `libs/cdk-constructs/src/utils/lambda-profiles.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 16 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts \
        libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add adapterProps profile with paramsAndSecrets layer"
```

---

### Task A4: Add `reducerProps` profile

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Modify: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
import { reducerProps } from '../../src/utils/lambda-profiles';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL with `has no exported member 'reducerProps'`.

- [ ] **Step 3: Add the `reducerProps` export**

Append to `libs/cdk-constructs/src/utils/lambda-profiles.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 23 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts \
        libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add reducerProps profile for stream-heavy workloads"
```

---

### Task A5: Add `agentProps` profile

**Files:**
- Modify: `libs/cdk-constructs/src/utils/lambda-profiles.ts`
- Modify: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
import { agentProps } from '../../src/utils/lambda-profiles';

describe('agentProps — Bedrock/LLM-calling profile', () => {
  it('uses 1024 MB memory (cold-start sensitive)', () => {
    expect(agentProps.lambdaProps.memorySize).toBe(1024);
  });

  it('uses 5 minute timeout (LLM calls are slow)', () => {
    expect(agentProps.lambdaProps.timeout).toEqual(Duration.minutes(5));
  });

  it('uses SQS batch size 1 — one event = one LLM invocation', () => {
    expect(agentProps.sqsBatchSize).toBe(1);
  });

  it('uses zero batching window (no amortization benefit)', () => {
    expect(agentProps.sqsMaxBatchingWindow).toEqual(Duration.seconds(0));
  });

  it('caps SQS concurrency to 5 (below Bedrock throttle limits)', () => {
    expect(agentProps.sqsMaxConcurrency).toBe(5);
  });

  it('does NOT bundle the params-and-secrets layer', () => {
    expect(agentProps.lambdaProps.paramsAndSecrets).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL with `has no exported member 'agentProps'`.

- [ ] **Step 3: Add the `agentProps` export**

Append to `libs/cdk-constructs/src/utils/lambda-profiles.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 29 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/lambda-profiles.ts \
        libs/cdk-constructs/test/utils/lambda-profiles.test.ts
git commit -m "feat(cdk-constructs): add agentProps profile for LLM-calling Lambdas"
```

---

### Task A6: Export profiles from `utils/index.ts`

**Files:**
- Modify: `libs/cdk-constructs/src/utils/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/cdk-constructs/test/utils/lambda-profiles.test.ts`:

```typescript
describe('lambda-profiles — barrel export', () => {
  it('re-exports profiles from @nestfolio/cdk-constructs/utils', async () => {
    const utils = await import('../../src/utils');
    expect(utils.handlerProps).toBeDefined();
    expect(utils.adapterProps).toBeDefined();
    expect(utils.reducerProps).toBeDefined();
    expect(utils.agentProps).toBeDefined();
  });

  it('re-exports LambdaProfile type', async () => {
    // Type is erased at runtime — this test asserts the import path compiles.
    type Profile = import('../../src/utils').LambdaProfile;
    const check: Profile = { lambdaProps: {} };
    expect(check).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: FAIL — `utils.handlerProps` is `undefined` (not yet re-exported from the barrel).

- [ ] **Step 3: Update `utils/index.ts` to re-export profiles**

Replace the contents of `libs/cdk-constructs/src/utils/index.ts`:

```typescript
// @nestfolio/cdk-constructs/utils — Utility functions
export { defaultLambdaProps, agentLambdaProps } from './default-lambda-props';
export { NamingService, NamingServiceConfig, createNamingService, getPrefix, discoverSubsystem } from './naming-service';
export { applyStandardTags, StandardTagsProps } from './tagging';
export { resolvePipelineConfig, ResolvedPipelineConfig, ScheduleConfig, inferServiceMetadata, loadTierDefaults, mergeConfigs, HARDCODED_FALLBACKS } from './resolve-pipeline-config';
export {
  BASE_LAMBDA_PROPS,
  PARAMS_AND_SECRETS_LAYER,
  LambdaProfile,
  handlerProps,
  adapterProps,
  reducerProps,
  agentProps,
} from './lambda-profiles';
```

Note: `agentLambdaProps` is still exported here — it will be removed in Task D1 after we confirm no consumers.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=lambda-profiles`
Expected: PASS — 31 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/utils/index.ts
git commit -m "feat(cdk-constructs): re-export lambda profiles from utils barrel"
```

---

## Phase B — Ingress Construct: `maxConcurrency` and `profile`

### Task B1: Add `maxConcurrency` prop to `Ingress`

Add the `maxConcurrency` knob to the `SqsEventSource` so agent services (and any other rate-sensitive consumer) can cap concurrent Lambda invocations at the event-source level.

**Files:**
- Modify: `libs/cdk-constructs/src/core/ingress.ts`
- Modify: `libs/cdk-constructs/test/core/ingress.test.ts`

- [ ] **Step 1: Write the failing test**

In `libs/cdk-constructs/test/core/ingress.test.ts`, add inside the existing `describe('SQS config', ...)` block:

```typescript
    it('does not set maxConcurrency by default', () => {
      const { template } = createIngress();
      const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
      const sqsMapping = Object.values(mappings).find(
        (m) => m.Properties?.EventSourceArn?.['Fn::GetAtt']?.[0]?.startsWith('TestIngressQueue'),
      );
      expect(sqsMapping).toBeDefined();
      expect(sqsMapping!.Properties.ScalingConfig).toBeUndefined();
    });

    it('applies explicit maxConcurrency to the SQS event source', () => {
      const { template } = createIngress({
        ingressOverrides: { maxConcurrency: 7 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 7 },
      });
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=ingress`
Expected: FAIL — `'maxConcurrency' does not exist in type 'IngressProps'`.

- [ ] **Step 3: Add the prop and wire it into `SqsEventSource`**

In `libs/cdk-constructs/src/core/ingress.ts`, add `maxConcurrency` to the `IngressProps` interface (place it next to `maxBatchingWindow`):

```typescript
  maxBatchingWindow?: Duration;
  /** Maximum concurrent Lambda invocations from the SQS event source. Unset = no cap. */
  maxConcurrency?: number;
  maxRetries?: number;
```

Then update the `SqsEventSource` instantiation at the bottom of the constructor:

```typescript
    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      maxConcurrency: props.maxConcurrency,
      reportBatchItemFailures: true,
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=ingress`
Expected: PASS — all pre-existing tests still pass plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/core/ingress.ts \
        libs/cdk-constructs/test/core/ingress.test.ts
git commit -m "feat(cdk-constructs): add maxConcurrency prop to Ingress SqsEventSource"
```

---

### Task B2: Add `profile` prop to `Ingress`

Wire the `LambdaProfile` into `Ingress`. Precedence: **explicit construct prop → profile default → construct hardcoded default**. Services passing no profile must see identical CloudFormation output (backwards compat).

**Files:**
- Modify: `libs/cdk-constructs/src/core/ingress.ts`
- Modify: `libs/cdk-constructs/test/core/ingress.test.ts`

- [ ] **Step 1: Write the failing test**

In `libs/cdk-constructs/test/core/ingress.test.ts`, add this import at the top of the file, next to the existing imports:

```typescript
import { adapterProps, agentProps } from '../../src/utils/lambda-profiles';
```

Then add a new `describe('LambdaProfile integration', ...)` block at the end of the file (before the final closing brace of the outer `describe('Ingress construct', ...)`):

```typescript
  describe('LambdaProfile integration', () => {
    it('applies profile lambdaProps to the handler (agentProps: 1024 MB, 5min timeout)', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 1024,
        Timeout: 300,
      });
    });

    it('applies profile sqsBatchSize to the event source', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 1,
      });
    });

    it('applies profile sqsMaxConcurrency to the event source', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 5 },
      });
    });

    it('explicit batchSize overrides profile sqsBatchSize', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps, batchSize: 3 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 3,
      });
    });

    it('explicit lambdaProps overrides profile lambdaProps', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: agentProps,
          lambdaProps: { memorySize: 2048 },
        },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 2048,
        // Profile timeout still applies because it wasn't overridden.
        Timeout: 300,
      });
    });

    it('explicit lambdaTimeout overrides profile timeout AND drives visibility timeout', () => {
      const { template } = createIngress({
        ingressOverrides: {
          profile: agentProps,
          lambdaTimeout: Duration.seconds(60),
        },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 60,
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 360,
      });
    });

    it('explicit maxConcurrency overrides profile sqsMaxConcurrency', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: agentProps, maxConcurrency: 2 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ScalingConfig: { MaximumConcurrency: 2 },
      });
    });

    it('no profile — behavior identical to current defaults (256 MB, 30s, batch 10)', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 256,
        Timeout: 30,
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 10,
      });
    });

    it('adapterProps profile bundles paramsAndSecrets layer on the Lambda', () => {
      const { template } = createIngress({
        ingressOverrides: { profile: adapterProps },
      });
      // The extension layer ARN includes 'ParamsAndSecretsExtension' in its logical name.
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.arrayWith([Match.anyValue()]),
      });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=ingress`
Expected: FAIL — `'profile' does not exist in type 'IngressProps'`.

- [ ] **Step 3: Add the `profile` prop and wire precedence**

In `libs/cdk-constructs/src/core/ingress.ts`:

1. Add imports at the top (after the existing imports):

```typescript
import type { LambdaProfile } from '../utils/lambda-profiles';
```

2. Add the `profile` prop to `IngressProps` (place it immediately after `lambdaProps`):

```typescript
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /**
   * Workload profile supplying Lambda and event-source defaults.
   * Precedence: explicit props > profile > construct defaults.
   */
  profile?: LambdaProfile;
  batchSize?: number;
```

3. Replace the Lambda creation block (the one that currently says `// Create Lambda` followed by `this.handler = new NodejsFunction(this, 'Handler', { ... })`) with the following final version:

```typescript
    // Create Lambda — precedence: explicit lambdaTimeout > explicit lambdaProps > profile.lambdaProps > defaultLambdaProps
    const profileLambdaProps = props.profile?.lambdaProps ?? {};
    const lambdaTimeoutOverride: Partial<NodejsFunctionProps> = props.lambdaTimeout
      ? { timeout: props.lambdaTimeout }
      : {};
    this.handler = new NodejsFunction(this, 'Handler', {
      ...defaultLambdaProps(this),
      ...profileLambdaProps,
      ...props.lambdaProps,
      ...lambdaTimeoutOverride,
      entry,
      environment: env,
    });
```

4. Replace the visibility timeout calculation block. Currently:

```typescript
    const visibilityTimeout = props.visibilityTimeout
      ?? (props.lambdaTimeout
        ? Duration.seconds(6 * props.lambdaTimeout.toSeconds())
        : Duration.seconds(180));
```

Replace with:

```typescript
    // Lambda timeout source (for auto-calculated visibility timeout):
    // explicit lambdaTimeout > explicit lambdaProps.timeout > profile.lambdaProps.timeout > 30s fallback
    const effectiveLambdaTimeout =
      props.lambdaTimeout
      ?? (props.lambdaProps?.timeout as Duration | undefined)
      ?? (profileLambdaProps.timeout as Duration | undefined)
      ?? Duration.seconds(30);
    const visibilityTimeout = props.visibilityTimeout
      ?? Duration.seconds(6 * effectiveLambdaTimeout.toSeconds());
```

5. Replace the `SqsEventSource` block at the bottom of the constructor. Currently:

```typescript
    // SQS -> Lambda
    const batchingWindow = props.maxBatchingWindow
      ?? Duration.millis(props.maxBatchingWindowMs ?? 1000);

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      maxConcurrency: props.maxConcurrency,
      reportBatchItemFailures: true,
    }));
```

Replace with:

```typescript
    // SQS -> Lambda — precedence: explicit prop > profile default > construct default
    const profile = props.profile;
    const batchSize = props.batchSize ?? profile?.sqsBatchSize ?? 10;
    const batchingWindow =
      props.maxBatchingWindow
      ?? (props.maxBatchingWindowMs != null ? Duration.millis(props.maxBatchingWindowMs) : undefined)
      ?? profile?.sqsMaxBatchingWindow
      ?? Duration.seconds(1);
    const maxConcurrency = props.maxConcurrency ?? profile?.sqsMaxConcurrency;

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize,
      maxBatchingWindow: batchingWindow,
      maxConcurrency,
      reportBatchItemFailures: true,
    }));
```

This ensures that when a caller passes `profile: agentProps` AND `lambdaTimeout: Duration.seconds(60)`, the Lambda gets a 60s timeout (not the profile's 5min), while the SQS visibility timeout is also calculated from the 60s value (6 × 60 = 360s).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=ingress`
Expected: PASS — all existing Ingress tests still pass plus the 9 new `LambdaProfile integration` tests.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/core/ingress.ts \
        libs/cdk-constructs/test/core/ingress.test.ts
git commit -m "feat(cdk-constructs): wire LambdaProfile into Ingress with precedence chain"
```

---

## Phase C — Egress Construct: new props + `profile`

### Task C1: Add `maxBatchingWindow` and `parallelizationFactor` props to `Egress`

**Files:**
- Modify: `libs/cdk-constructs/src/core/egress.ts`
- Modify: `libs/cdk-constructs/test/core/egress.test.ts`

- [ ] **Step 1: Write the failing test**

In `libs/cdk-constructs/test/core/egress.test.ts`, inside the existing `describe('DynamoDB Streams config', ...)` block, append:

```typescript
    it('applies explicit maxBatchingWindow to the event source mapping', () => {
      const { template } = createEgress({
        egressOverrides: { maxBatchingWindow: Duration.seconds(3) },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumBatchingWindowInSeconds: 3,
      });
    });

    it('applies explicit parallelizationFactor to the event source mapping', () => {
      const { template } = createEgress({
        egressOverrides: { parallelizationFactor: 4 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ParallelizationFactor: 4,
      });
    });
```

Add `Duration` to the existing imports at the top of the file if not already present:

```typescript
import { App, Duration } from 'aws-cdk-lib';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=egress`
Expected: FAIL — `'maxBatchingWindow' does not exist in type 'EgressProps'`.

- [ ] **Step 3: Add the props to `Egress`**

In `libs/cdk-constructs/src/core/egress.ts`:

1. Add the props to `EgressProps` (place them immediately after the existing `batchSize?: number;`):

```typescript
  /** DynamoDB Streams batch size. Default: DynamoDB stream default */
  batchSize?: number;
  /** DynamoDB Streams batching window. Default: unset (AWS default 0s) */
  maxBatchingWindow?: Duration;
  /** DynamoDB Streams parallelization factor. Default: unset (AWS default 1) */
  parallelizationFactor?: number;
```

2. Update the `DynamoEventSource` instantiation at the bottom of the constructor:

```typescript
    this.handler.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        bisectBatchOnError: true,
        retryAttempts: props.retryAttempts ?? 3,
        batchSize: props.batchSize,
        maxBatchingWindow: props.maxBatchingWindow,
        parallelizationFactor: props.parallelizationFactor,
        onFailure: new SqsDlq(this.dlq),
        filters: filterCriteria,
      }),
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=egress`
Expected: PASS — all existing Egress tests still pass plus the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/core/egress.ts \
        libs/cdk-constructs/test/core/egress.test.ts
git commit -m "feat(cdk-constructs): expose maxBatchingWindow and parallelizationFactor on Egress"
```

---

### Task C2: Add `profile` prop to `Egress`

**Files:**
- Modify: `libs/cdk-constructs/src/core/egress.ts`
- Modify: `libs/cdk-constructs/test/core/egress.test.ts`

- [ ] **Step 1: Write the failing test**

In `libs/cdk-constructs/test/core/egress.test.ts`, add this import at the top of the file, next to the existing imports:

```typescript
import { reducerProps } from '../../src/utils/lambda-profiles';
```

Then add a new `describe('LambdaProfile integration', ...)` block at the end of the file (before the final closing brace of the outer `describe('Egress construct', ...)`):

```typescript
  describe('LambdaProfile integration', () => {
    it('applies profile lambdaProps to the publisher (reducerProps: 512 MB)', () => {
      const { template } = createEgress({
        egressOverrides: { profile: reducerProps },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('applies profile ddbStreamBatchSize to the event source mapping', () => {
      const { template } = createEgress({
        egressOverrides: { profile: reducerProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 100,
      });
    });

    it('applies profile ddbStreamMaxBatchingWindow to the event source mapping', () => {
      const { template } = createEgress({
        egressOverrides: { profile: reducerProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumBatchingWindowInSeconds: 5,
      });
    });

    it('applies profile ddbStreamParallelizationFactor to the event source mapping', () => {
      const { template } = createEgress({
        egressOverrides: { profile: reducerProps },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        ParallelizationFactor: 1,
      });
    });

    it('explicit batchSize overrides profile ddbStreamBatchSize', () => {
      const { template } = createEgress({
        egressOverrides: { profile: reducerProps, batchSize: 42 },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 42,
      });
    });

    it('explicit lambdaProps overrides profile lambdaProps', () => {
      const { template } = createEgress({
        egressOverrides: {
          profile: reducerProps,
          lambdaProps: { memorySize: 1024 },
        },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 1024,
      });
    });

    it('no profile — behavior identical to current defaults (256 MB, unset batch)', () => {
      const { template } = createEgress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 256,
      });
      // No profile means no BatchSize override; AWS default applies.
      const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
      const mapping = Object.values(mappings)[0];
      expect(mapping.Properties.BatchSize).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test cdk-constructs --testPathPattern=egress`
Expected: FAIL — `'profile' does not exist in type 'EgressProps'`.

- [ ] **Step 3: Add the `profile` prop and wire precedence**

In `libs/cdk-constructs/src/core/egress.ts`:

1. Add the import at the top:

```typescript
import type { LambdaProfile } from '../utils/lambda-profiles';
```

2. Add the `profile` prop to `EgressProps` (place it immediately after `lambdaProps`):

```typescript
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /**
   * Workload profile supplying publisher Lambda and DDB Stream defaults.
   * Precedence: explicit props > profile > construct defaults.
   */
  profile?: LambdaProfile;
  /** DynamoDB Streams retry attempts before sending to DLQ. Default: 3 */
  retryAttempts?: number;
```

3. Replace the `new NodejsFunction(this, 'Publisher', {...})` block with:

```typescript
    // Publisher Lambda — precedence: explicit lambdaProps > profile.lambdaProps > defaultLambdaProps
    const profileLambdaProps = props.profile?.lambdaProps ?? {};
    this.handler = new NodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      ...profileLambdaProps,
      ...props.lambdaProps,
      entry,
      environment: env,
    });
```

4. Replace the `new DynamoEventSource(...)` block at the bottom of the constructor with:

```typescript
    // DynamoDB Streams event source — precedence: explicit prop > profile > construct default
    const profile = props.profile;
    const eventSourceBatchSize =
      props.batchSize ?? profile?.ddbStreamBatchSize;
    const eventSourceMaxBatchingWindow =
      props.maxBatchingWindow ?? profile?.ddbStreamMaxBatchingWindow;
    const eventSourceParallelizationFactor =
      props.parallelizationFactor ?? profile?.ddbStreamParallelizationFactor;

    this.handler.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        bisectBatchOnError: true,
        retryAttempts: props.retryAttempts ?? 3,
        batchSize: eventSourceBatchSize,
        maxBatchingWindow: eventSourceMaxBatchingWindow,
        parallelizationFactor: eventSourceParallelizationFactor,
        onFailure: new SqsDlq(this.dlq),
        filters: filterCriteria,
      }),
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test cdk-constructs --testPathPattern=egress`
Expected: PASS — all pre-existing Egress tests still pass plus the 7 new `LambdaProfile integration` tests.

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/core/egress.ts \
        libs/cdk-constructs/test/core/egress.test.ts
git commit -m "feat(cdk-constructs): wire LambdaProfile into Egress with precedence chain"
```

---

## Phase D — Remove the Unused `agentLambdaProps` Helper

The `agentLambdaProps` helper in `default-lambda-props.ts` was defined for agent Lambdas but never imported anywhere outside the library (verified by grep: the only consumers are the barrel export and its own test file). It is superseded by `agentProps`. Remove it.

### Task D1: Remove `agentLambdaProps`

**Files:**
- Modify: `libs/cdk-constructs/src/utils/default-lambda-props.ts`
- Modify: `libs/cdk-constructs/src/utils/index.ts`
- Modify: `libs/cdk-constructs/test/utils/default-lambda-props.test.ts`

- [ ] **Step 1: Verify no consumers exist outside the library**

Run: `pnpm exec rg "agentLambdaProps" services libs --type ts`
Expected: only three matches, all inside `libs/cdk-constructs/`:
- `libs/cdk-constructs/src/utils/default-lambda-props.ts` (definition)
- `libs/cdk-constructs/src/utils/index.ts` (re-export)
- `libs/cdk-constructs/test/utils/default-lambda-props.test.ts` (test)

If any matches exist under `services/`, STOP — a consumer appeared since the audit. Migrate the consumer(s) to `agentProps` first, then resume this task.

- [ ] **Step 2: Remove the `agentLambdaProps` helper and its test block**

Replace the entire contents of `libs/cdk-constructs/src/utils/default-lambda-props.ts`:

```typescript
import { Construct } from 'constructs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Default Lambda props for standard service handlers (30s timeout).
 * Note: SQS Ingress visibility timeout (180s) must be >= 6x this value.
 *
 * For richer workload-specific defaults, prefer the `LambdaProfile`
 * system in `./lambda-profiles.ts` (`handlerProps`, `adapterProps`,
 * `reducerProps`, `agentProps`).
 */
export const defaultLambdaProps = (_scope: Construct): Partial<NodejsFunctionProps> => ({
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(30),
  tracing: Tracing.ACTIVE,
  logRetention: RetentionDays.THREE_MONTHS,
  bundling: {
    minify: true,
    sourceMap: true,
    target: 'node24',
    externalModules: ['@aws-sdk/*'],
  },
});
```

Replace the contents of `libs/cdk-constructs/src/utils/index.ts`:

```typescript
// @nestfolio/cdk-constructs/utils — Utility functions
export { defaultLambdaProps } from './default-lambda-props';
export { NamingService, NamingServiceConfig, createNamingService, getPrefix, discoverSubsystem } from './naming-service';
export { applyStandardTags, StandardTagsProps } from './tagging';
export { resolvePipelineConfig, ResolvedPipelineConfig, ScheduleConfig, inferServiceMetadata, loadTierDefaults, mergeConfigs, HARDCODED_FALLBACKS } from './resolve-pipeline-config';
export {
  BASE_LAMBDA_PROPS,
  PARAMS_AND_SECRETS_LAYER,
  LambdaProfile,
  handlerProps,
  adapterProps,
  reducerProps,
  agentProps,
} from './lambda-profiles';
```

Replace the contents of `libs/cdk-constructs/test/utils/default-lambda-props.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run the full library test suite to verify nothing broke**

Run: `pnpm nx test cdk-constructs`
Expected: PASS — all tests pass (including lambda-profiles and the trimmed default-lambda-props).

- [ ] **Step 4: Commit**

```bash
git add libs/cdk-constructs/src/utils/default-lambda-props.ts \
        libs/cdk-constructs/src/utils/index.ts \
        libs/cdk-constructs/test/utils/default-lambda-props.test.ts
git commit -m "refactor(cdk-constructs): remove unused agentLambdaProps helper (superseded by agentProps)"
```

---

## Phase E — Service Migrations

Each service migration is its own commit so any individual service can be rolled back without affecting the others. Every task ends with a `cdk synth` or `nx test` verification step for that service.

### Task E1: Migrate `fred-adpt` to `adapterProps`

Preserves the service-specific `lambdaTimeout: 90s` (FRED API is slow).

**Files:**
- Modify: `services/advisory/fred-adpt/src/service.stack.ts`

- [ ] **Step 1: Verify current synth produces a baseline**

Run: `pnpm nx run fred-adpt:synth 2>&1 | tail -20`
Expected: synthesis succeeds (note: if `fred-adpt` has no `synth` target, use `pnpm nx run fred-adpt:build` instead). Remember the final output so you can compare after the migration.

- [ ] **Step 2: Remove the local `paramsAndSecrets` boilerplate and adopt the profile**

In `services/advisory/fred-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { FredAdptEventTypes } from './domain/events';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

Then delete the local `paramsAndSecrets` constant (lines 33-37 of the original file):

```typescript
    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

Then replace the `Ingress` call (the block starting `const ingress = new Ingress(this, 'Ingress', {`) with:

```typescript
    // Ingress: subscribes to FETCH_REQUESTED, materializes FredIndicator records into DDB
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [FredAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      lambdaTimeout: Duration.seconds(90),
      environment: {
        FRED_API_KEY: fredApiKey,
        FRED_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

Note: `lambdaTimeout: Duration.seconds(90)` is preserved because FRED API calls can take up to 90s. The profile's default of 60s would have reduced this.

- [ ] **Step 3: Run the synth and the service's unit tests**

Run: `pnpm nx run fred-adpt:test && pnpm nx run fred-adpt:build`
Expected: PASS — tests green, build succeeds.

- [ ] **Step 4: Diff the synthesized template against the baseline (optional sanity check)**

Run: `pnpm nx run fred-adpt:build 2>&1 | tail -5`
Expected: build succeeds. The Ingress Lambda should now have `Layers: [<paramsAndSecretsLayerArn>]` identical to the pre-migration output; the `MemorySize` is 256, `Timeout` is 90. Visibility timeout on the SQS queue should remain 540s (6 × 90).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/fred-adpt/src/service.stack.ts
git commit -m "refactor(fred-adpt): migrate Ingress to adapterProps profile"
```

---

### Task E2: Migrate `marketwatch-adpt` to `adapterProps`

Preserves the service-specific `lambdaTimeout: 60s` (matches the profile default but keeping the explicit value for clarity since it was already there).

**Files:**
- Modify: `services/advisory/marketwatch-adpt/src/service.stack.ts`

- [ ] **Step 1: Update imports and remove local `paramsAndSecrets`**

In `services/advisory/marketwatch-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { MarketwatchAdptEventTypes } from './domain/events';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 2: Delete the local `paramsAndSecrets` constant**

Delete these 5 lines from the stack constructor:

```typescript
    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

- [ ] **Step 3: Replace the `Ingress` call to use the profile**

Replace this block:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [MarketwatchAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(60),
      environment: {
        MARKETWATCH_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
      lambdaProps: { paramsAndSecrets },
    });
```

with:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [MarketwatchAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      environment: {
        MARKETWATCH_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

Note: the explicit `lambdaTimeout: Duration.seconds(60)` is removed because `adapterProps` already sets 60s. If the service ever needs to revert it, pass `lambdaTimeout` explicitly.

- [ ] **Step 4: Run the service tests and build**

Run: `pnpm nx run marketwatch-adpt:test && pnpm nx run marketwatch-adpt:build`
Expected: PASS — tests green, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/marketwatch-adpt/src/service.stack.ts
git commit -m "refactor(marketwatch-adpt): migrate Ingress to adapterProps profile"
```

---

### Task E3: Migrate `alpha-vantage-adpt` to `adapterProps`

Preserves the service-specific `lambdaTimeout: 90s` (Alpha Vantage free tier is slow).

**Files:**
- Modify: `services/advisory/alpha-vantage-adpt/src/service.stack.ts`

- [ ] **Step 1: Update imports and remove local `paramsAndSecrets`**

In `services/advisory/alpha-vantage-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { AlphaVantageAdptEventTypes } from './domain/events';
```

- [ ] **Step 2: Delete the local `paramsAndSecrets` constant**

Delete these 5 lines from the constructor:

```typescript
    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

- [ ] **Step 3: Replace the `Ingress` call to use the profile**

Replace this block:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [AlphaVantageAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(90),
      environment: {
        ALPHA_VANTAGE_API_KEY: avApiKey,
        ALPHA_VANTAGE_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
      lambdaProps: { paramsAndSecrets },
    });
```

with:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [AlphaVantageAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      lambdaTimeout: Duration.seconds(90),
      environment: {
        ALPHA_VANTAGE_API_KEY: avApiKey,
        ALPHA_VANTAGE_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

- [ ] **Step 4: Run the service tests and build**

Run: `pnpm nx run alpha-vantage-adpt:test && pnpm nx run alpha-vantage-adpt:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/src/service.stack.ts
git commit -m "refactor(alpha-vantage-adpt): migrate Ingress to adapterProps profile"
```

---

### Task E4: Migrate `yahoo-finance-adpt` to `adapterProps`

Current `lambdaTimeout: 60s` exactly matches the profile default — explicit value is dropped.

**Files:**
- Modify: `services/advisory/yahoo-finance-adpt/src/service.stack.ts`

- [ ] **Step 1: Update imports and remove local `paramsAndSecrets`**

In `services/advisory/yahoo-finance-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { YahooFinanceAdptEventTypes } from './domain/events';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 2: Delete the local `paramsAndSecrets` constant**

Delete these 5 lines from the constructor:

```typescript
    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

- [ ] **Step 3: Replace the `Ingress` call**

Replace this block:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [YahooFinanceAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(60),
      environment: {
        TICKERS: tickers,
        YAHOO_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
      lambdaProps: { paramsAndSecrets },
    });
```

with:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [YahooFinanceAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      environment: {
        TICKERS: tickers,
        YAHOO_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

- [ ] **Step 4: Run the service tests and build**

Run: `pnpm nx run yahoo-finance-adpt:test && pnpm nx run yahoo-finance-adpt:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/yahoo-finance-adpt/src/service.stack.ts
git commit -m "refactor(yahoo-finance-adpt): migrate Ingress to adapterProps profile"
```

---

### Task E5: Migrate `sec-edgar-adpt` to `adapterProps`

Preserves BOTH the service-specific `memorySize: 512` (EDGAR XBRL parsing is memory-heavy) AND `lambdaTimeout: 120s`.

**Files:**
- Modify: `services/advisory/sec-edgar-adpt/src/service.stack.ts`

- [ ] **Step 1: Update imports and remove local `paramsAndSecrets`**

In `services/advisory/sec-edgar-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AdapterSchedule, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { adapterProps, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { SecEdgarAdptEventTypes } from './domain/events';
```

- [ ] **Step 2: Delete the local `paramsAndSecrets` constant**

Delete these 5 lines from the constructor:

```typescript
    // ParamsAndSecrets Extension for SSM-based base URL resolution
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

- [ ] **Step 3: Replace the `Ingress` call**

Replace this block:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [SecEdgarAdptEventTypes.FETCH_REQUESTED],
      lambdaTimeout: Duration.seconds(120),
      lambdaProps: { memorySize: 512, paramsAndSecrets },
      environment: {
        TRACKED_CIKS: '0000102909,0000088053,0000914208',
        EDGAR_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

with:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [SecEdgarAdptEventTypes.FETCH_REQUESTED],
      profile: adapterProps,
      lambdaTimeout: Duration.seconds(120),
      lambdaProps: { memorySize: 512 },
      environment: {
        TRACKED_CIKS: '0000102909,0000088053,0000914208',
        EDGAR_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
      },
    });
```

Note: `lambdaProps: { memorySize: 512 }` still wins over the profile's 256 MB default (explicit-prop precedence). `lambdaTimeout: 120s` overrides the profile's 60s default.

- [ ] **Step 4: Run the service tests and build**

Run: `pnpm nx run sec-edgar-adpt:test && pnpm nx run sec-edgar-adpt:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/sec-edgar-adpt/src/service.stack.ts
git commit -m "refactor(sec-edgar-adpt): migrate Ingress to adapterProps (preserves 512MB/120s)"
```

---

### Task E6: Migrate `broker-alpaca-adpt` to `adapterProps`

This is the one service where `paramsAndSecrets` is used on BOTH the `Ingress` Lambda AND two standalone `NodejsFunction`s (OrderPollFn, TransferPollFn). The Ingress uses the profile; the standalone Lambdas continue to reference the shared layer directly via `PARAMS_AND_SECRETS_LAYER`.

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/service.stack.ts`

- [ ] **Step 1: Update imports**

In `services/execution/broker-alpaca-adpt/src/service.stack.ts`, replace the imports block at the top (lines 1-11) with:

```typescript
import { join } from 'path';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Egress, Ingress, Orchestration, ServiceStack, ServiceStackProps, State } from '@nestfolio/cdk-constructs/core';
import { adapterProps, defaultLambdaProps, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
import { AlpacaAdptEventTypes } from './domain/events';
import { OrderPollingDefinition } from './constructs/order-polling-definition';
import { TransferPollingDefinition } from './constructs/transfer-polling-definition';
```

- [ ] **Step 2: Delete the local `paramsAndSecrets` constant**

Delete these 4 lines from the constructor:

```typescript
    const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
      ParamsAndSecretsVersions.V1_0_103,
      { parameterStoreTtl: Duration.seconds(5) },
    );
```

- [ ] **Step 3: Migrate the `Ingress` to use `adapterProps`**

Replace this block:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
      environment: {
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      lambdaProps: { paramsAndSecrets },
    });
```

with:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
      profile: adapterProps,
      environment: {
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
    });
```

- [ ] **Step 4: Update the two standalone poll Lambdas to reference the shared layer**

Replace the `OrderPollFn` block:

```typescript
    const orderPollFn = new NodejsFunction(this, 'OrderPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'order-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets,
      timeout: Duration.seconds(30),
    });
```

with:

```typescript
    const orderPollFn = new NodejsFunction(this, 'OrderPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'order-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      timeout: Duration.seconds(30),
    });
```

Replace the `TransferPollFn` block:

```typescript
    const transferPollFn = new NodejsFunction(this, 'TransferPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'transfer-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets,
      timeout: Duration.seconds(30),
    });
```

with:

```typescript
    const transferPollFn = new NodejsFunction(this, 'TransferPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'transfer-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      },
      paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      timeout: Duration.seconds(30),
    });
```

Note: the standalone poll Lambdas don't need the full `adapterProps` (no SQS, no batching). They stay on `defaultLambdaProps` and just reference the shared layer constant — killing the local factory call.

- [ ] **Step 5: Run the service tests and build**

Run: `pnpm nx run broker-alpaca-adpt:test && pnpm nx run broker-alpaca-adpt:build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-alpaca-adpt/src/service.stack.ts
git commit -m "refactor(broker-alpaca-adpt): migrate Ingress to adapterProps, share PARAMS_AND_SECRETS_LAYER"
```

---

### Task E7: Migrate `ledger-ctrl` `ReducerFn` to `reducerProps`

The hand-rolled `NodejsFunction` + `DynamoEventSource` for account snapshot materialization gets its Lambda shape from `reducerProps.lambdaProps` and its stream tuning from `reducerProps.ddbStream*`. The existing explicit batch size (100) and window (5s) match the profile exactly, so they become implicit.

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update imports**

In `services/ledger/ledger-ctrl/src/service.stack.ts`, replace the imports block at the top (lines 1-12) with:

```typescript
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { LedgerCtrlEventTypes } from './domain/events';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerIngestEventTypes } from '@nestfolio/ledger-adpt/domain';
import { reducerProps } from '@nestfolio/cdk-constructs/utils';
```

Note: `Duration` and `defaultLambdaProps` are removed from imports — no longer used.

- [ ] **Step 2: Replace the `ReducerFn` and its `DynamoEventSource`**

Replace this block:

```typescript
    // Reducer: DDB Stream consumer that materializes account snapshots
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
        SNAPSHOT_HISTORY_TTL_DAYS: '365',
      },
    });
    state.getTable().grantReadWriteData(reducerFn);

    reducerFn.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: 100,
      maxBatchingWindow: Duration.seconds(5),
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('LedgerEntry') },
            },
          },
        }),
      ],
    }));
```

with:

```typescript
    // Reducer: DDB Stream consumer that materializes account snapshots.
    // Shape comes from reducerProps (512 MB, 60s, batch 100, window 5s, parallelization 1).
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...reducerProps.lambdaProps,
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
        SNAPSHOT_HISTORY_TTL_DAYS: '365',
      },
    });
    state.getTable().grantReadWriteData(reducerFn);

    reducerFn.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: reducerProps.ddbStreamBatchSize,
      maxBatchingWindow: reducerProps.ddbStreamMaxBatchingWindow,
      parallelizationFactor: reducerProps.ddbStreamParallelizationFactor,
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('LedgerEntry') },
            },
          },
        }),
      ],
    }));
```

- [ ] **Step 3: Run the service's existing stack tests**

Run: `pnpm nx run ledger-ctrl:test --testPathPattern=service.stack`
Expected: PASS. If the stack test asserts on `MemorySize: 256`, it needs updating — the reducer now uses 512 MB. Update the test assertion in place:

```typescript
// Old: expect(fn.Properties.MemorySize).toBe(256) for the reducer
// New: expect(fn.Properties.MemorySize).toBe(512) for the reducer
```

Find the test that asserts on `ReducerFn`'s MemorySize and update it. If no such assertion exists, no test change is needed.

- [ ] **Step 4: Run the full service tests and build**

Run: `pnpm nx run ledger-ctrl:test && pnpm nx run ledger-ctrl:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/service.stack.ts \
        services/ledger/ledger-ctrl/test/service.stack.test.ts
git commit -m "refactor(ledger-ctrl): migrate ReducerFn to reducerProps (512MB, explicit stream tuning from profile)"
```

---

### Task E8: Migrate `investor-profile-ctrl` Ingress to `agentProps`

The Ingress handler for this service consumes `ANALYZE_INVESTOR_PROFILE` events and invokes Bedrock (Opus + Haiku) for risk assessment. It needs the larger memory, longer timeout, and concurrency cap of `agentProps`. The `KBIngestion` standalone Lambda stays on `defaultLambdaProps` — it only writes to S3 and triggers sync.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update imports**

In `services/advisory/investor-profile-ctrl/src/service.stack.ts`, replace this line:

```typescript
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
```

with:

```typescript
import { agentProps, defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 2: Apply `agentProps` to the Ingress**

Replace this block:

```typescript
    // Ingress: trigger event + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.ANALYZE_INVESTOR_PROFILE,
        ComplianceEventTypes.DECISION_BLOCKED,
        ComplianceEventTypes.DECISION_APPROVED,
      ],
    });
```

with:

```typescript
    // Ingress: trigger event + KB ingestion events.
    // Uses agentProps because the handler dispatches to Bedrock (Opus + Haiku) —
    // 1024 MB / 5min timeout / batchSize 1 / concurrency capped at 5.
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.ANALYZE_INVESTOR_PROFILE,
        ComplianceEventTypes.DECISION_BLOCKED,
        ComplianceEventTypes.DECISION_APPROVED,
      ],
      profile: agentProps,
    });
```

- [ ] **Step 3: Update the stack test if it asserts on Ingress memory or timeout**

Run: `pnpm nx run investor-profile-ctrl:test --testPathPattern=service.stack`
If assertions fail because of the new memory (1024 MB) or timeout (300 s), update them in place:

```typescript
// Old: expect(ingressFn.Properties.MemorySize).toBe(256)
// New: expect(ingressFn.Properties.MemorySize).toBe(1024)
```

If no assertions on these properties exist, no test change is needed.

- [ ] **Step 4: Run the full service tests and build**

Run: `pnpm nx run investor-profile-ctrl:test && pnpm nx run investor-profile-ctrl:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/service.stack.ts \
        services/advisory/investor-profile-ctrl/test/service.stack.test.ts
git commit -m "refactor(investor-profile-ctrl): migrate Ingress to agentProps (LLM handler)"
```

---

### Task E9: Migrate `portfolio-engine-ctrl` Ingress to `agentProps`

Same rationale as Task E8. The Ingress handler dispatches `CONSTRUCT_PORTFOLIO` events to Bedrock (Opus + Sonnet). `PortfolioLookup` (DDB read) and `KBIngestion` (S3 upload) stay on `defaultLambdaProps`.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update imports**

In `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`, replace this line:

```typescript
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
```

with:

```typescript
import { agentProps, defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 2: Apply `agentProps` to the Ingress**

Replace this block:

```typescript
    // Ingress: trigger + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
        SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
        SecEdgarAdptEventTypes.SEC_10K_UPDATED,
      ],
    });
```

with:

```typescript
    // Ingress: trigger + KB ingestion events.
    // Uses agentProps because the handler dispatches to Bedrock (Opus + Sonnet) —
    // 1024 MB / 5min timeout / batchSize 1 / concurrency capped at 5.
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
        SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
        SecEdgarAdptEventTypes.SEC_10K_UPDATED,
      ],
      profile: agentProps,
    });
```

- [ ] **Step 3: Update the stack test if it asserts on Ingress memory or timeout**

Run: `pnpm nx run portfolio-engine-ctrl:test --testPathPattern=service.stack`
If assertions fail because of the new memory (1024 MB) or timeout (300 s), update them in place. If no assertions on these properties exist, no test change is needed.

- [ ] **Step 4: Run the full service tests and build**

Run: `pnpm nx run portfolio-engine-ctrl:test && pnpm nx run portfolio-engine-ctrl:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts \
        services/advisory/portfolio-engine-ctrl/test/service.stack.test.ts
git commit -m "refactor(portfolio-engine-ctrl): migrate Ingress to agentProps (LLM handler)"
```

---

## Phase F — Final Verification

After all services are migrated, run the full affected test + build + synth to confirm nothing regressed.

### Task F1: Run `nx affected` across the whole workspace

**Files:** None — verification only.

- [ ] **Step 1: Run affected tests from the merge base**

Run: `pnpm nx affected -t test --base=main --head=HEAD`
Expected: PASS — all affected project tests green. This should cover `cdk-constructs` plus every migrated service.

- [ ] **Step 2: Run affected builds**

Run: `pnpm nx affected -t build --base=main --head=HEAD`
Expected: PASS — all affected projects build cleanly (CDK synth included for stacks that have a build target).

- [ ] **Step 3: Grep for any remaining direct `ParamsAndSecretsLayerVersion.fromVersion` calls in services**

Run: `pnpm exec rg "ParamsAndSecretsLayerVersion\.fromVersion" services --type ts`
Expected: ZERO matches. Every service now either uses `adapterProps` (which bundles the layer) or `PARAMS_AND_SECRETS_LAYER` directly (for standalone non-Ingress Lambdas like `broker-alpaca-adpt`'s poll handlers).

If any matches remain, STOP — a migration was missed. Review the file, migrate it, and re-run this step.

- [ ] **Step 4: Grep for any remaining `agentLambdaProps` references**

Run: `pnpm exec rg "agentLambdaProps" services libs --type ts`
Expected: ZERO matches.

- [ ] **Step 5: No commit — verification phase only**

If all steps pass, the plan is complete. The final state:

1. `libs/cdk-constructs` exposes `handlerProps` / `adapterProps` / `reducerProps` / `agentProps` + an expanded `Ingress`/`Egress` prop surface.
2. 9 service stacks are migrated to opt-in profiles.
3. All `paramsAndSecrets` boilerplate is consolidated into either the profile or a single shared layer constant.
4. The dead `agentLambdaProps` helper is deleted.
5. Zero behavior change for any service that did not explicitly opt in (the 22 remaining `-ctrl` / `-bff` / internal-adapter / `broker-sim-adpt` services).

---

## Notes for the Executing Engineer

**Nx task names:** This workspace runs every task through `pnpm nx`. Do not run `cdk synth` or `jest` directly — always via `pnpm nx run <project>:<target>`. Check `project.json` in each service for available targets (`build`, `test`, `synth`, `deploy`). If a service has no `synth` target, `build` is the closest equivalent and will run the CDK app through `ts-node` with path-alias resolution.

**Why profiles are constants, not factories:** `defaultLambdaProps` is a `(scope: Construct) => …` function historically, but the `scope` parameter is unused (`_scope`). Profiles are plain object constants because nothing about them depends on construct-tree scope — even the `paramsAndSecrets` layer (`PARAMS_AND_SECRETS_LAYER`) is just a regional ARN reference and is safe to create at module load time and share across stacks.

**Precedence is load-bearing.** The point of the whole system is that services can still override any individual knob. Never remove the `...props.lambdaProps` spread that comes after the profile spread — that's the line that lets `sec-edgar-adpt` keep its 512 MB memory override while still opting into `adapterProps` for everything else.

**Internal cross-domain adapters are out of scope by design.** `investor-adpt`, `advisory-adpt`, `execution-adpt`, `ledger-adpt` do NOT have Ingress/Lambda instances — they are pure EB Rule → EB Target forwarding. If you see a task asking to migrate one, STOP and re-read this plan's Scope section.

**`broker-sim-adpt` is NOT a third-party adapter** despite its `-adpt` suffix. It simulates a broker locally and does not call any external API — it stays on the default (no profile). Do not migrate it to `adapterProps`.

**The integration tests hit real AWS.** If any service migration unexpectedly breaks its integration tests, that almost certainly indicates a real behavior change (memory/timeout/batch size affecting correctness), not a test-harness issue. Investigate rather than relaxing the test.

**The reducer pattern is unique to `ledger-ctrl`.** `reconciliation-ctrl` was considered but has no standalone reducer — its logic runs in the normal Ingress handler. Do not invent a new reducer just to apply `reducerProps`.
