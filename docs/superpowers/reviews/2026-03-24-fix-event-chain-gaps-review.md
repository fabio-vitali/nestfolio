# Plan Review: fix-event-chain-gaps.md

**Reviewer:** Code Review Agent
**Date:** 2026-03-24
**Plan:** `docs/superpowers/plans/2026-03-24-fix-event-chain-gaps.md`
**Verdict:** Mostly sound, with 3 Critical issues, 4 Important issues, and 3 Suggestions

---

## What Was Done Well

- All file paths verified correct against the actual repo structure.
- The CDC function-based resolver approach (Task 1) is confirmed supported: `ChangeDataCaptureConfig.eventTypeMap` accepts `Record<string, string | ((record: StreamRecord) => string)>` and `resolveEventType()` checks `typeof resolver === 'function'`.
- Wave ordering is correct: CDC fixes (W1) before notification fixes (W2) before staged-order (W3) before recovery (W4) before docs (W5).
- The `record()` intent function signature matches the plan's usage pattern.
- Existing test files confirmed in `test/` directory (not `src/__tests__/`).

---

## Critical Issues (Must Fix)

### C1: `buildEventTypeMap` return type is `Record<string, string>` -- cannot hold function resolvers

**Location:** Task 1 Step 3, Task 2 Step 6

The plan proposes:
```typescript
eventTypeMap: {
  ...buildEventTypeMap(['Order', 'StagedOrder']),
  'Order:INSERT': (record) => { ... },  // function resolver
}
```

But `buildEventTypeMap()` returns `Record<string, string>` (not `Record<string, string | Function>`). Spreading it into an object with a function value works at runtime but creates a **type mismatch**: `changeDataCapture()` expects `Record<string, string | ((record: StreamRecord) => string)>`, and TypeScript will infer the spread object correctly. However, the **test code in Task 1 Step 1** declares the map as `Record<string, string | ((r: Record<string, unknown>) => string)>` -- the function parameter type is wrong. It should be `StreamRecord`, not `Record<string, unknown>`.

**Fix:** Change the test's function type annotation to use `StreamRecord` from `@nestfolio/event-processor` types, or rely on type inference. Also in the handler implementation (Step 3), the function parameter should be `StreamRecord`, not `Record<string, unknown>`.

### C2: `createCdcTestHarness` is NOT exported from `@nestfolio/event-processor/testing`

**Location:** Task 1 Step 1, Task 2 Step 8

The plan imports `createCdcTestHarness` from `@nestfolio/event-processor/testing`, but the testing barrel (`libs/event-processor/src/testing/index.ts`) only exports:
```
export { createTestHarness } from './test-harness';
export type { TestHarnessConfig, TestResult } from './test-harness';
export { fakeSqsRecord, fakeDdbStreamRecord } from './fake-records';
```

`createCdcTestHarness` exists in the test-harness file but is **not re-exported**. The plan must either:
1. Add `export { createCdcTestHarness } from './test-harness'` to the testing barrel, OR
2. Import directly from the internal module path.

**Fix:** Add a pre-requisite step to export `createCdcTestHarness` (and `CdcTestResult`) from the testing barrel.

### C3: broker-adpt uses `createIngestionHandler`, which does NOT support `record()` return values for CDC materialization

**Location:** Task 2 Steps 1-5, Task 3 Steps 1-3

The plan acknowledges this concern in Step 1 ("Check if `createIngestionHandler` supports `record()` returns") but then proceeds to write test code assuming it does. After review:

- `createIngestionHandler` feeds handlers through `IngestionEngine`, which calls handler functions and collects `WriteIntent` results.
- `createIngestionHandler` accepts a `table` config and DOES write `record()` intents to DynamoDB via `IntentExecutor`.
- So `record()` return IS supported.

**However**, the plan says broker-adpt currently uses `createIngestionHandler` at line 155 with no `table` config visible in the plan's code. Looking at the actual handler export:
```typescript
export const handler = createIngestionHandler({
  serviceName: 'broker-adpt',
  handlers: createHandlers({ repository, simulationEngine }),
  errorEventType: 'EXECUTION_ADPT_FAILED',
});
```

There is **no `table` property** in the config. Without `table`, `createIngestionHandler` has no DynamoDB client/table to write `record()` intents to. The intent executor needs a table name and DynamoDB client to persist records.

**Fix:** The plan must add `table: TABLE_NAME` to the `createIngestionHandler` config for broker-adpt, OR switch to `materializeToTable` as the plan itself suggests as a fallback. This is the most critical issue -- without it, `record()` intents will silently fail or throw.

---

## Important Issues (Should Fix)

### I1: Task 2 test assertions use wrong result shape for `createIngestionHandler`

**Location:** Task 2 Step 2, Task 3 Step 1

The plan's test assertions reference `result.intents[0]` with `_tag: 'record'` and `typename`, which is the `TestResult` shape from `createTestHarness`. But if broker-adpt uses `createIngestionHandler`, the test needs to use `createTestHarness` with the same handler config. The plan should clarify which test harness to use.

The existing broker-adpt tests (`test/event-listener.test.ts`) use manual `jest.mock` patterns, NOT `createTestHarness`. The plan should either follow the existing test pattern or explicitly migrate to `createTestHarness`.

### I2: Task 4 (M1) -- WITHDRAWAL_COMPLETED is already forwarded to LedgerBus, but plan says it's not forwarded to InvestorBus

**Location:** Task 4 Step 1

Verified: The plan correctly identifies that `WITHDRAWAL_COMPLETED` is NOT in the ToInvestor rule (lines 40-45 of execution-adpt stack). It IS in the ToLedger rule (line 64). The fix is correct. However, the plan's proposed code snippet shows adding it after `WITHDRAWAL_REJECTED`, which matches the current pattern. **No issue here** -- confirmed correct.

### I3: Task 5 -- investor-ctrl uses `materializeToTable` NOT `createIngestionHandler`

**Location:** Task 5 Step 4

The plan says to add types to `EVENT_TYPES` array. This is correct -- investor-ctrl builds handlers from `EVENT_TYPES.map()`. However, the plan also mentions importing `ExecutionCrossDomainEventTypes` and `LedgerCrossDomainEventTypes`. These imports ALREADY exist in the file (lines 6-7). The plan should note these are pre-existing rather than implying they need to be added.

Also, the plan adds `DECISION_BLOCKED` to EVENT_TYPES but needs to import it. The import `AdvisoryCrossDomainEventTypes` already exists at line 5, but `DECISION_BLOCKED` needs to come from `@nestfolio/advisory-adpt/domain`. Checking the advisory-adpt domain, it does NOT export `DECISION_BLOCKED` -- that comes from `@nestfolio/compliance-ctrl/events` (as `ComplianceEventTypes.DECISION_BLOCKED`). The investor-ctrl would need to import from the correct module.

**Fix:** Verify which module exports `DECISION_BLOCKED` for cross-domain consumption. If it is forwarded from advisory-adpt to InvestorBus, investor-ctrl should reference it by string literal in the Ingress stack and use a direct string in EVENT_TYPES, OR add the appropriate import.

### I4: Task 6 -- `getStagedOrders` only queries by single tenantId, not cross-tenant

**Location:** Task 6 Step 3

The plan calls `deps.repository.getStagedOrders('*')` to query all tenants, but the actual method signature is:
```typescript
readonly getStagedOrders = async (tenantId: string): Promise<Record<string, unknown>[]>
```
It queries by `tenantId = :tid` on a GSI. Passing `'*'` will query for a literal tenantId of `'*'`, returning nothing.

**Fix:** The plan correctly notes this ("may need a DDB Scan or dedicated GSI") but then proceeds with `getStagedOrders('*')` anyway. A new `getAllStagedOrders()` method using a Scan with `__typename = 'StagedOrder'` filter is required. This should be an explicit sub-step.

---

## Suggestions (Nice to Have)

### S1: Task 6 CDK Schedule uses hardcoded UTC offset

The plan uses `Schedule.cron({ minute: '30', hour: '14', weekDay: 'MON-FRI' })` for 9:30 AM ET. This is correct only during EST (UTC-5). During EDT (UTC-4), 9:30 AM ET = 13:30 UTC. Consider using `Schedule.expression('cron(30 13 ? * MON-FRI *)')` with a comment noting DST implications, or use an EventBridge Scheduler with timezone support (`aws-scheduler` L2 construct).

### S2: Task 7 (S2) -- advisory-ctrl idempotency is in `DecisionLifecycleService`, not event-listener

The plan describes modifying the event-listener's idempotency check, but the actual idempotency guard is in `DecisionLifecycleService.executeDecisionLifecycle()`:
```typescript
const created = await this.repository.createDecisionPacket(...);
if (!created) { return { status: 'DUPLICATE', ... }; }
```
This uses `createDecisionPacket` which does a conditional DDB write (`attribute_not_exists(pk)`). The idempotency is keyed by `dpId = context.triggerEvent.id` (the eventId), not by tenant status.

This means the plan's proposed fix (checking for `TERMINAL_STATUSES`) is targeting the wrong layer. The idempotency is per-event, not per-tenant. A new trigger event (MANDATE_GRANTED with a different eventId) will create a new decision packet regardless of the previous packet's status.

**The S2 issue may not actually exist as described.** The dead-end is that a BLOCKED decision has no recovery path, but it does NOT prevent new decisions from being created. The plan should re-evaluate whether Task 7 is needed at all, or reframe it as "add a retry/resolve endpoint" instead.

### S3: Task 8 data-flow docs verification

The plan references `docs/data-flows/08-order-execution.md`, `09-order-ledger.md`, and `13-portfolio-rebalancing.md`. Verified: the directory exists with these files. No issues here.

---

## Summary of Required Changes Before Execution

| # | Severity | Issue | Tasks Affected |
|---|----------|-------|---------------|
| C1 | Critical | Function resolver parameter type should be `StreamRecord` not `Record<string, unknown>` | Task 1 |
| C2 | Critical | `createCdcTestHarness` not exported from testing barrel | Tasks 1, 2, 3 |
| C3 | Critical | broker-adpt `createIngestionHandler` has no `table` config -- `record()` intents won't persist | Tasks 2, 3 |
| I1 | Important | Test assertions assume `createTestHarness` shape but handler uses `createIngestionHandler` | Tasks 2, 3 |
| I2 | Important | Import source for `DECISION_BLOCKED` cross-domain event needs verification | Task 5 |
| I3 | Important | N/A (confirmed correct) | Task 4 |
| I4 | Important | `getStagedOrders('*')` will not work -- needs `getAllStagedOrders()` method | Task 6 |
| S1 | Suggestion | DST-aware scheduling | Task 6 |
| S2 | Suggestion | Task 7 may be solving a non-existent problem (idempotency is per-event, not per-tenant) | Task 7 |
| S3 | Suggestion | Docs exist, no issue | Task 8 |
