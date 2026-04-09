# Integration Test Resilience Design

> **Goal:** Eliminate transient AWS failures in integration tests so the suite passes reliably under parallel execution — locally and in CI.

## Problem Statement

The integration test suite (28 services, `--parallel=4`) experiences transient failures caused by:

1. **EventBusTrap rule propagation** — The 2-second hardcoded wait after creating an EB rule is insufficient. EventBridge can take 5-15 seconds to activate a new rule. Tests that put events immediately after trap deployment miss the window.
2. **DDB Stream / CDC latency** — DDB Streams batch records with variable latency (1-30s). Under parallel load, Lambda cold starts compound this. CDC assertions with 30s timeouts occasionally miss.
3. **No putEvent retry** — `EventBridgeClient.putEvent()` has zero retry logic. Transient API throttling or network blips cause immediate failure.
4. **Scattered timing constants** — Timeouts, poll intervals, and warmup delays are hardcoded across fixtures with no central control or CI-awareness.

All affected tests pass individually. Failures occur only under parallel execution due to AWS resource contention.

## Design

### 1. Canary Warmup for EventBusTrap

**What:** After deploying the EB rule + SQS queue, `deploy()` sends a canary event through the target bus and waits for it to arrive in SQS. This empirically proves the pipeline is active before returning.

**How:**

```
EventBusTrap.deploy():
  1. Create SQS queue
  2. Create EB rule (detailType filter includes real types + '__INTEG_CANARY')
  3. Set SQS policy, add target
  4. Send canary event:
     - Source: 'integration-test:canary'
     - DetailType: '__INTEG_CANARY'
     - Detail: { context: { tenantId: ctx.tenantId } }
  5. Poll SQS until canary arrives (timeout: ctx.timings.canaryTimeout)
  6. Discard canary from captured buffer
  7. Update EB rule to remove '__INTEG_CANARY' from filter (optional — canary events are harmless and filtered by waitForEvent)
  8. Return — trap is proven active
```

**Why not DescribeRule polling?** DescribeRule reports `State: ENABLED` immediately after creation, but the rule may not yet be matching events. The canary is the only way to verify end-to-end delivery.

**Failure mode:** If canary doesn't arrive within `canaryTimeout` (default 15s), `deploy()` throws with a clear message: `"EventBusTrap: canary event did not arrive after {timeout}ms — EB rule may not be active"`. This fails the test in `beforeAll` with an infrastructure error, not a misleading assertion failure.

**Impact on `waitForEvent`:** The `'__INTEG_CANARY'` detailType never matches any real test assertion because `waitForEvent` filters by the caller's requested detailType. If a canary somehow leaks into the captured buffer, it's ignored.

### 2. Central Timing Configuration

**What:** A `TimingConfig` interface with all timing constants, created once in `createIntegrationContext()` and read by all fixtures via `ctx.timings`.

**Interface:**

```typescript
interface TimingConfig {
  /** Default timeout for waitForEvent / waitForItem (ms) */
  eventTimeout: number;       // default: 45_000

  /** Poll interval for SQS / DDB polling (ms) */
  pollInterval: number;       // default: 2_000

  /** Canary warmup timeout (ms) */
  canaryTimeout: number;      // default: 15_000

  /** Number of retries for putEvent */
  putEventRetries: number;    // default: 3

  /** Base backoff for putEvent retries (ms) */
  putEventBackoffMs: number;  // default: 500
}
```

**Environment scaling:** If `INTEG_TIMEOUT_MULTIPLIER` env var is set (e.g., `2`), all timeout values are multiplied. This lets CI pipelines use more generous timeouts without changing code:

```typescript
const multiplier = Number(process.env.INTEG_TIMEOUT_MULTIPLIER) || 1;
const timings: TimingConfig = {
  eventTimeout: 45_000 * multiplier,
  pollInterval: 2_000,  // poll interval is NOT scaled (polling faster is fine)
  canaryTimeout: 15_000 * multiplier,
  putEventRetries: 3,
  putEventBackoffMs: 500,
};
```

**Override:** `createIntegrationContext({ timings: { eventTimeout: 60_000 } })` merges with defaults. Individual fixture calls can still override per-call (existing API unchanged).

**Fixture changes:** All fixtures read from `ctx.timings` instead of hardcoding:
- `EventBusTrap.waitForEvent()` default timeout → `ctx.timings.eventTimeout`
- `EventBusTrap.deploy()` canary timeout → `ctx.timings.canaryTimeout`
- `TableAssertions.waitForItem()` default timeout → `ctx.timings.eventTimeout`
- `EventBridgeClient.putEvent()` retries → `ctx.timings.putEventRetries`

### 3. putEvent Retry with Exponential Backoff

**What:** `EventBridgeClient.putEvent()` retries on transient failures with exponential backoff.

**Retry conditions:**
- AWS SDK throws (network error, throttling, 5xx)
- `PutEventsResponse.FailedEntryCount > 0` with retryable error code

**Backoff:** `putEventBackoffMs * 2^attempt` → 500ms, 1000ms, 2000ms for 3 retries.

**Implementation:**

```typescript
async putEvent(params: { ... }): Promise<void> {
  const maxRetries = this.ctx.timings.putEventRetries;
  const baseBackoff = this.ctx.timings.putEventBackoffMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await this.client.send(new PutEventsCommand({ ... }));
      if (result.FailedEntryCount === 0) return;
      if (attempt === maxRetries) {
        throw new Error(`putEvent failed after ${maxRetries} retries: ${result.Entries?.[0]?.ErrorMessage}`);
      }
    } catch (err) {
      if (attempt === maxRetries) throw err;
    }
    await new Promise(r => setTimeout(r, baseBackoff * Math.pow(2, attempt)));
  }
}
```

### 4. Jest retryTimes(1)

**What:** A shared setup file that enables one automatic retry for failed integration tests.

**File:** `libs/integration-testing/src/jest.integration.setup.ts`

```typescript
jest.retryTimes(1, { logErrorsBeforeRetry: true });
```

**Wiring:** Each service's `jest.integration.config.js` adds:

```javascript
setupFilesAfterSetup: ['@nestfolio/integration-testing/jest.integration.setup'],
```

Or via a shared preset if one exists.

**Why 1 retry, not 2+:** The canary warmup and increased timeouts should handle 99% of transients. The retry is a safety net for truly rare AWS blips (API timeout, network partition). If a test needs 2+ retries to pass, there's a real bug.

**Logging:** `logErrorsBeforeRetry: true` ensures the first failure is logged, so flaky tests are visible in CI output even when the retry passes.

### 5. Remove Best-Effort CDC Assertions

**After all resilience mechanisms are in place**, remove the try/catch wrappers added as a stopgap:

**Files to revert:**
- `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts` — DECISION_BLOCKED CDC + it.each trigger CDC
- `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts` — AGENT_INVOCATION_CREATED CDC
- `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts` — same
- `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts` — same
- `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts` — same

The CDC assertions become mandatory again. If CDC doesn't fire within `ctx.timings.eventTimeout` (45s, scalable via multiplier), the test fails — and the retry gives it one more chance.

## File Changes Summary

### Modified files
| File | Change |
|------|--------|
| `libs/integration-testing/src/context.ts` | Add `TimingConfig` interface, create timings in `createIntegrationContext()`, accept optional override |
| `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` | Canary warmup in `deploy()`, read timeouts from `ctx.timings` |
| `libs/integration-testing/src/fixtures/event-bridge-client.ts` | Add retry loop with backoff in `putEvent()` |
| `libs/integration-testing/src/fixtures/table-assertions.ts` | Read default timeout from `ctx.timings` |
| `libs/integration-testing/src/index.ts` | Export `TimingConfig`, export setup file path |
| `services/advisory/advisory-ctrl/test/integration/*.ts` | Remove try/catch from CDC assertions |
| `services/advisory/advisory-narrative-ctrl/test/integration/*.ts` | Remove try/catch from CDC assertions |
| `services/advisory/investor-profile-ctrl/test/integration/*.ts` | Remove try/catch from CDC assertions |
| `services/advisory/market-intelligence-ctrl/test/integration/*.ts` | Remove try/catch from CDC assertions |
| `services/advisory/portfolio-engine-ctrl/test/integration/*.ts` | Remove try/catch from CDC assertions |

### New files
| File | Purpose |
|------|---------|
| `libs/integration-testing/src/jest.integration.setup.ts` | Shared setup: `jest.retryTimes(1)` |

### Config changes (28 files)
All `jest.integration.config.js` files gain `setupFilesAfterSetup` pointing to the shared setup file.

## Validation Plan

1. **Unit test the canary:** Mock EB + SQS to verify canary flow in `deploy()`.
2. **Run adapter tests individually** — verify canary warmup eliminates propagation failures.
3. **Run full suite `--parallel=4`** — verify 28/28 pass.
4. **Run full suite `--parallel=6`** — stress test under higher contention.
5. **Set `INTEG_TIMEOUT_MULTIPLIER=0.5`** — verify tests fail faster (confirms multiplier works).
6. **Kill a canary mid-flight** (increase canary timeout to 1ms) — verify clear error message.

## Non-Goals

- **Rate limiting / circuit breaking** — Overkill for test infrastructure. If AWS is consistently throttling, the problem is account limits, not test code.
- **Test ordering or isolation** — Tests are already isolated by tenantId. Parallel execution is fine; the issue is AWS propagation, not test interference.
- **Mocking AWS services** — Integration tests exist specifically to hit real AWS. Mocking defeats the purpose.
