# Integration Test Mock Resilience

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Shared test infrastructure (`integration-testing`, `test-support`) + per-service integration tests

## Problem

Integration tests silently call real external APIs (Bedrock, Alpaca) when mock infrastructure fails. Three root causes:

1. **Stale global-key DDB items** — CircuitBreaker and FeatureFlag items from interrupted runs cause handlers to short-circuit before reaching the mock.
2. **Lost SSM overrides** — Interrupted runs leave SSM pointing to dead mock Lambda URLs. The next run saves the dead URL as "original", permanently losing the real URL.
3. **No LLM mock** — 5 Bedrock services invoke real Bedrock AgentCore (slow, flaky, costs money). No mock infrastructure exists for agent runtime invocations.
4. **Orphaned AWS resources** — SQS queues, EB rules, Lambda functions, IAM roles accumulate from interrupted runs.

## Design

### 1. OrphanReaper — clean up leaked AWS resources

Utility that runs once in `beforeAll` of each test suite. Scans for `integ-*` resources older than 1 hour and deletes them.

**Location:** `libs/integration-testing/src/fixtures/orphan-reaper.ts`

**Resources cleaned:**
- Lambda functions matching `integ-mock-*` older than 1h → delete Function URL config, delete function
- IAM roles matching `integ-mock-*` older than 1h → detach policies, delete role
- SQS queues matching `integ-trap-*` older than 1h → delete queue
- EventBridge rules matching `integ-trap-*` older than 1h → remove targets, delete rule

**API:**
```typescript
export class OrphanReaper {
  constructor(ctx: TestContext) {}
  async cleanup(): Promise<void> {}
}
```

**Behavior:**
- Lists resources via AWS SDK (ListFunctions, ListRoles, ListQueues, ListRules)
- Filters by prefix `integ-mock-` or `integ-trap-` AND creation time > 1 hour ago
- Deletes in best-effort mode (logs errors, does not throw)
- Idempotent — safe to call multiple times, safe during concurrent test runs (only deletes old resources)
- Registered via `ctx.cleanup` is NOT needed — this cleans up other runs' mess, not its own

**Usage:**
```typescript
beforeAll(async () => {
  ctx = await createTestContext();
  await new OrphanReaper(ctx).cleanup();
  // ... rest of setup
}, 90_000);
```

### 2. Crash-safe SsmOverrideFixture — survive interrupted runs

Enhanced `SsmOverrideFixture` that persists the original value in a `.backup` SSM sibling parameter.

**Location:** `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` (modify existing)

**Override flow:**
1. Check if `{paramName}.backup` exists in SSM.
   - **Exists:** Previous run crashed. Use `.backup` as the real original. Do NOT overwrite `.backup`.
   - **Does not exist:** First override. Read current main param value. Write to `{paramName}.backup`.
2. Write `testValue` to main param.
3. Wait `waitMs` (default 6000ms) for Lambda Extension cache expiry.
4. Register cleanup.

**Restore flow (normal cleanup in afterAll):**
1. Read `{paramName}.backup`.
2. Write backup value to main param.
3. Delete `{paramName}.backup`.

**Recovery flow (next run after crash):**
- `override()` detects `.backup` exists → uses it as original → overrides main param as normal.
- After successful test run, cleanup deletes `.backup` and restores real URL.
- The real URL is never lost.

**Edge cases:**
- First-ever run (no `.backup`, main param has CDK-deployed value): saves to `.backup`, proceeds normally.
- Second consecutive crash: `.backup` still has the real value from the first crash. Next run recovers correctly.
- Concurrent test runs on different prefixes: each prefix has its own SSM namespace — no conflict.

### 3. StateResetFixture — clear stale global-key DDB items

New fixture that deletes DDB items with fixed (non-tenant-scoped) PKs that may have been left behind by interrupted runs.

**Location:** `libs/integration-testing/src/fixtures/state-reset.fixture.ts`

**API:**
```typescript
export class StateResetFixture {
  constructor(ctx: TestContext) {}
  async reset(entries: Array<{ table: string; pk: string }>): Promise<void> {}
}
```

**Behavior:**
- For each entry: resolve table name via `ctx.ssm.tableName(table)`, query all items with the given PK, delete each item via DeleteItem.
- Best-effort: logs errors, does not throw.
- No cleanup registration needed — these are stale items from previous runs, not items created by this run.

**Known stale-state patterns:**

| Service | Table | PK | Written by |
|---------|-------|----|------------|
| broker-alpaca-adpt | broker-alpaca-adpt | `CircuitBreaker#alpaca` | Circuit breaker open handler |
| investor-bff | investor-bff | `FeatureFlag#SYSTEM` | BROKER_CIRCUIT_OPEN handler |

**Usage:**
```typescript
beforeAll(async () => {
  ctx = await createTestContext();
  const stateReset = new StateResetFixture(ctx);
  await stateReset.reset([
    { table: 'broker-alpaca-adpt', pk: 'CircuitBreaker#alpaca' },
  ]);
  // ... rest of setup
}, 90_000);
```

### 4. Mock Agent Runtime — Bedrock service mocking

Same pattern as the 6 HTTP adapter mocks (MockApiFixture + SsmOverrideFixture). Applied to 5 Bedrock services.

**Affected services:**
- advisory-ctrl
- investor-profile-ctrl
- portfolio-engine-ctrl
- advisory-narrative-ctrl
- market-intelligence-ctrl

> **Note:** decision-workflow-ctrl does NOT have an AgentRuntime or agents/ directory — it orchestrates
> the decision lifecycle via Step Functions task tokens, not via in-process agent invocation.

#### 4a. CDK stack change (per service)

Add SSM parameter for agent runtime URL:

```typescript
// In service.stack.ts
import { PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';

const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-${serviceName}/agent/runtimeUrl`,
  stringValue: 'DISABLED', // SSM rejects empty strings — resolveAgentRuntimeUrl() treats non-URL values as null
});
```

Add `paramsAndSecrets` to the Ingress construct's `lambdaProps` (required for `resolveAgentRuntimeUrl()` to reach the Parameters and Secrets Extension at `localhost:2773`):

```typescript
paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
```

After Ingress creation, add env var and grant SSM read permission:

```typescript
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

#### 4b. Shared helper in agent-orchestrator (replaces per-service inline resolution)

The `resolveAgentRuntimeUrl()` and `invokeRemoteRuntime()` helpers live in `libs/agent-orchestrator/src/resolve-runtime-url.ts` — shared by all 5 services. Uses Powertools Logger (consistent with `invoke-orchestrator.ts`).

Each service's lifecycle/agent-service class calls:

```typescript
import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';

// Inside the pipeline method:
const runtimeUrl = await resolveAgentRuntimeUrl();
if (runtimeUrl) {
  return invokeRemoteRuntime<ResultType>(runtimeUrl, payload);
}
// else: existing in-process path
```

`resolveAgentRuntimeUrl` reads `AGENT_RUNTIME_URL_PARAM` env var → fetches value via Parameters and Secrets Extension → returns URL if it starts with `https://`, null otherwise (CDK default `'DISABLED'` → null → in-process). Logs a warning on SSM fetch errors instead of failing silently.

#### 4c. Mock handler (per service)

Each service gets a `test/mocks/mock-agent-runtime.ts` returning a canned response matching its result type.

The mock handler receives the lifecycle context as POST body and returns the service-specific result shape (e.g., `DecisionLifecycleStateType` for advisory-ctrl).

Build pipeline: esbuild → `dist/index.mjs` → zip as `mock-agent-runtime.zip` (same as existing mock-alpaca pattern).

#### 4d. Integration test setup (per service)

```typescript
beforeAll(async () => {
  ctx = await createTestContext();

  // Deploy mock agent runtime
  const mockApi = new MockApiFixture(ctx);
  const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
  const mockUrl = await mockApi.deploy({
    name: 'mock-agent-runtime',
    handlerAsset: readFileSync(zipPath),
  });

  // Override SSM to point to mock (crash-safe)
  const ssmOverride = new SsmOverrideFixture(ctx);
  await ssmOverride.override({
    paramName: `/nestfolio/${ctx.prefix}-advisory-ctrl/agent/runtimeUrl`,
    testValue: mockUrl,
  });

  // ... rest of setup (eb, trap, table)
}, 90_000);
```

## Integration test fixture ordering

Each test suite's `beforeAll` follows this order:

```
1. createTestContext()
2. OrphanReaper.cleanup()          — clean old integ-* AWS resources
3. StateResetFixture.reset([...])  — clear stale global-key DDB items
4. MockApiFixture.deploy(...)      — deploy mock Lambda (if service has external API)
5. SsmOverrideFixture.override()   — redirect SSM to mock (crash-safe backup)
6. EventBridgeClient, EventBusTrap, TableAssertions — standard test fixtures
```

## Files changed

**New (shared):**
- `libs/integration-testing/src/fixtures/orphan-reaper.ts` — AWS resource cleanup utility
- `libs/integration-testing/src/fixtures/state-reset.fixture.ts` — stale DDB item cleanup
- `libs/agent-orchestrator/src/resolve-runtime-url.ts` — shared SSM-based URL resolution (Powertools Logger)

**Modified (shared):**
- `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` — crash-safe `.backup` param logic
- `libs/integration-testing/src/index.ts` — export new fixtures
- `libs/agent-orchestrator/src/index.ts` — export new helper

**Modified (stale state fix):**
- `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` — add StateResetFixture
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` — add StateResetFixture

**Per Bedrock service (5 services — advisory-ctrl, investor-profile-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl):**
- `src/service.stack.ts` — add SSM param for agent runtime URL
- `src/agent-service.ts` or `src/services/decision-lifecycle.service.ts` — add runtime URL resolution
- `test/mocks/mock-agent-runtime.ts` + `.gitignore` — canned response handler
- `test/integration/*.integration.test.ts` — add MockApiFixture + SsmOverrideFixture

## Not in scope

- CDK-level `NESTFOLIO_INTEG` env var (Approach 3 — deferred)
- `assertExternalApiSafe()` generalization (existing `assertAlpacaSafe` stays in broker-alpaca-adpt)
- Mock build pipeline automation (zip build remains manual via esbuild, same as existing mocks)
