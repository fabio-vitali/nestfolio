# Remove IdempotencyGuard — Event-Keyed Conditional Writes

**Date**: 2026-03-15
**Status**: Draft
**Scope**: All 11 event listeners, 23 pipes, 3 lifecycle services, lambda-utils, platform-core

## Problem

Every event listener performs a separate DynamoDB write (`Idempotency#{eventType}#{eventId}`) **before** the business logic. This adds latency (extra round-trip), cost (extra WCU), and complexity (separate `IdempotencyGuard` class injected everywhere). The business writes themselves are already keyed by deterministic data from the event payload — we can use those keys directly for deduplication.

## Universal Rule

**Every DDB write triggered by an event must be key-deterministic from the source event.**

- Never use `getUUID()` for record keys in event-processing code paths
- Derive IDs from the source `event.id` (or stable payload fields like `notificationId`, `decisionId`, `orderId`)
- For one-event-to-many-records, append a deterministic suffix: `${eventId}-audit`, `${eventId}-report`, or `${decisionPacketId}-${symbol}`

## Three Write Patterns

All event-driven DDB writes fall into one of three categories:

### Pattern 1: Conditional Put (creates)

For writes that create a new record. Add `attribute_not_exists(pk)` condition to the Put. Catch `ConditionalCheckFailedException` and return silently.

```typescript
// TableRepository gains a new method:
protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
  try {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return true; // created
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false; // already exists — skip
    }
    throw error;
  }
}
```

All records created via `putIfNotExists` should include a `sourceEventId` attribute storing the originating `event.id`. This replaces the audit trail previously provided by `Idempotency#` marker records and enables tracing which event created which business record.

**Used by**: `createProfile`, `addNotification`, `storeDecision`, `createNotification`, `createDecisionPacket`, `createOrder`, `createComplianceCheck`, `createAuditArtifact`, `putLedgerEntry`

### Pattern 2: Idempotent Upsert (updates/overwrites)

SET operations on a deterministic key are naturally idempotent. No change needed.

**Used by**: `upsertReadOnlyBalance`, `upsertPortfolioSummary`, `upsertPositionSnapshot`, `upsertInvestorSnapshot`, `updateDecisionStatus`, `putMandateSnapshot`, all ledger-bff pipes

### Pattern 3: Guarded Transaction (additive operations)

For ADD/increment operations where replaying doubles the effect. Use `TransactWriteItems` that atomically writes a marker record + performs the business operation.

```typescript
// lambda-utils gains a new utility:
export async function guardedWrite(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  guardKey: { pk: string; sk: string },
  transactItems: Record<string, unknown>[],
): Promise<boolean> {
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: { ...guardKey, __typename: 'ProcessedEvent', ttl: Math.floor(Date.now() / 1000) + 86400 },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          ...transactItems,
        ],
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TransactionCanceledException') {
      // AWS SDK v3: TransactionCanceledException has typed CancellationReasons
      const reasons = (error as any).CancellationReasons as Array<{ Code?: string }> | undefined;
      if (reasons?.[0]?.Code === 'ConditionalCheckFailed') {
        return false; // guard marker exists — skip
      }
    }
    throw error;
  }
}
```

The guard marker uses `pk` from the business entity's partition + `sk: ProcessedEvent#${eventId}` (or `ProcessedEvent#${eventId}#${pipeName}` for multi-pipe BFFs). This keeps the marker in the same partition as the business data.

**TTL**: The guard marker has a 24-hour TTL (same as the current IdempotencyGuard). For financial operations (`addToCashBalance`, `atomicIncrementTotalValue`), consider using 7 days (`604800`) to cover DLQ replay scenarios. The TTL is configurable via a parameter.

**Typed error handling**: Use the AWS SDK v3 typed `TransactionCanceledException` import rather than casting to a loosely-typed object.

**Used by**: `atomicIncrementTotalValue`, `upsertAdvisoryStatus` (pendingDecisionsDelta), `addToCashBalance`, `nextSequence` + `putLedgerEntry` (combined)

## Per-Service Changes

### 1. investor-bff

| Pipe | Current | New |
|------|---------|-----|
| `UserRegisteredPipe` | `ensureOnce` + `createProfile` (double-guarded!) | `createProfile` → `putIfNotExists` |
| `NotificationCreatedPipe` | `ensureOnce` + `addNotification` | `addNotification` → `putIfNotExists` (key already uses `notificationId` from payload) |
| `BalanceUpdatedPipe` | `ensureOnce` + `upsertReadOnlyBalance` | No change (Pattern 2 — upsert) |

**Event listener**: Remove `idempotencyGuard` from deps + `ensureOnce` block.
**UserRegisteredPipe**: Remove `idempotencyGuard` constructor param + internal `ensureOnce` call.

### 2. dashboard-bff

Currently uses per-pipe idempotency: `ensureOnce(eventType, ${eventType}#${eventId}#${pipeName})`.

| Pipe | Pattern | Change |
|------|---------|--------|
| `PortfolioSummaryPipe` | **Pattern 3** (additive: `atomicIncrementTotalValue`) | `guardedWrite` with marker `ProcessedEvent#${eventId}#portfolioSummary` |
| `PositionSnapshotPipe` | **Pattern 2** (upsert) | No change |
| `RecentActivityPipe` | **Pattern 1** (create) | Change `sk: Activity#${now}#${getUUID()}` → `Activity#${eventId}` with `putIfNotExists` |
| `AdvisoryStatusPipe` | **Pattern 3** (additive: `pendingDecisionsDelta` uses `if_not_exists + :delta`) | `guardedWrite` with marker `ProcessedEvent#${eventId}#advisoryStatus` |
| `InvestorSnapshotPipe` | **Pattern 2** (upsert) | No change |
| `TimeTravelAvailabilityPipe` | **Pattern 2** (upsert) | No change |
| `SimulationSummaryPipe` | **Pattern 2** (upsert) | No change |

**Event listener**: Remove per-pipe `ensureOnce` loop. Pass `eventId` to each pipe (via UoW — already available as `uow.event.id`).

### 3. advisory-bff

| Pipe | Pattern | Change |
|------|---------|--------|
| `DecisionPacketCreatedPipe` | **Pattern 1** (create) | `storeDecision` → `putIfNotExists` (key already uses `decisionId` from payload). Remove `idempotencyGuard` constructor param. |
| `DecisionStatusChangedPipe` | **Pattern 2** (upsert) | No change |

### 4. ledger-bff

Same structure as dashboard-bff (per-pipe idempotency loop).

| Pipe | Pattern | Change |
|------|---------|--------|
| `BalanceUpdatedPipe` | **Pattern 2** (upsert) | No change |
| `PortfolioUpdatedPipe` | **Pattern 2** (upsert) | No change |
| `LedgerEntryRecordedPipe` | **Pattern 2** (upsert) | No change |

**Event listener**: Remove per-pipe `ensureOnce` loop.

### 5. investor-ctrl

**NotificationLifecycleService**:
- `notificationId = getUUID()` → `notificationId = triggerEvent.id`
- `reportId = getUUID()` → `reportId = triggerEvent.id + '-report'`
- `createNotification` → `putIfNotExists`. If returns `false` → return early (already processed).
- `createMonthlyReport` → `putIfNotExists`. If returns `false` → skip report (duplicate).

**Event listener**: Remove `idempotencyGuard` from deps.

### 6. advisory-ctrl

**DecisionLifecycleService**:
- `dpId = getUUID()` → `dpId = triggerEvent.id`
- `createDecisionPacket` → `putIfNotExists`. If returns `false` → return early.

**processComplianceCallback** / **processUserResponse**: Already Pattern 2 (updateDecisionStatus = Update).

**Event listener**: Remove `idempotencyGuard` from deps.

### 7. execution-ctrl

**OrderLifecycleService**:
- `orderId = getUUID()` → `orderId = event.id`
- `createOrder` → `putIfNotExists`. If returns `false` → return early.

**Event listener**: Remove `idempotencyGuard` from deps.

### 8. compliance-ctrl

**processDecisionPacket**:
- `ccId = getUUID()` → `ccId = event.id as string`
- `artifactId = getUUID()` → `artifactId = (event.id as string) + '-audit'`
- `createComplianceCheck` → `putIfNotExists`. If returns `false` → return early (event already processed).
- `createAuditArtifact` → `putIfNotExists`.

**processMandateEvent**: Already Pattern 2 (putMandateSnapshot = overwrite).

**Event listener**: Remove `idempotencyGuard` from deps.

### 9. execution-adpt

**processDepositInitiated**:
- `addToCashBalance` is an ADD → **Pattern 3**
- Use `guardedWrite` with marker `{ pk: ledgerPk(tenantId, userId), sk: ProcessedEvent#${event.id as string} }` wrapping the ADD UpdateCommand.

**processOrderSubmitted**:
- `SimulationEngineService.processOrderSubmitted` calls `executeTrade` with `tradeId = getUUID()` → change to `tradeId = orderId` (deterministic, one trade per order)
- `executeTrade` writes Trade record with `sk: Trade#${now}#${tradeId}` → change to `sk: Trade#${orderId}` with `putIfNotExists` condition on the transactWrite
- The `executeTrade` transactWrite already includes a version check on cash balance (optimistic locking). On replay, either the trade record condition fails (duplicate) or the version check fails (state moved on). Both should be caught and skipped silently.

**processWithdrawalRequested**:
- Same pattern as deposits — `guardedWrite` with marker.

**Event listener**: Remove `idempotencyGuard` from deps.

### 10. ledger-ctrl

**processActualEvent**:
- Change ledger entry key from `Event#${sequenceNo}#${eventId}` → `Event#${eventId}` (store sequenceNo as attribute)
- `putLedgerEntry` → `putIfNotExists`
- `nextSequence` remains BUT is called only when `putIfNotExists` returns `true` (the guard is the business write itself)

**processSimulationEvent**:
- Per-trade entries: change `eventId = getUUID()` → `eventId = ${event.id}-sim-${trade.symbol}`
- `putLedgerEntry` → `putIfNotExists` per trade

**Sequence gaps**: With the new approach, `nextSequence` is called only after `putIfNotExists` succeeds. For simulation events with multiple trades, a partial replay (some trades already exist, some new) will produce sequence gaps in the counter. This is acceptable — sequence numbers are used for ordering, not continuity. Consumers already handle sparse sequences via `queryEntriesSince` range queries.

**Event listener**: Remove `idempotencyGuard` from deps.

### 11. reconciliation-ctrl

**ReconciliationService**:
- `reconciliationId = getUUID()` → `reconciliationId = event.id` (passed from event listener)
- `createReconciliation` → `putIfNotExists`. If returns `false` → return early (already reconciled for this event).
- `createDriftRecord` per instrument → key derivation: `${reconciliationId}-${instrument}` with `putIfNotExists`
- `updateReconciliationStatus` → Pattern 2 (Update, idempotent)

**Event listener**: Remove `idempotencyGuard` from deps. Pass `uow.event.id` as the reconciliation ID to the service.

## Shared Library Changes

### platform-core: `TableRepository`

Add `putIfNotExists` method (Pattern 1). Returns `boolean` — `true` if created, `false` if already exists.

### lambda-utils

- Add `guardedWrite` utility function (Pattern 3).
- Delete `idempotency.ts` (the `IdempotencyGuard` class).
- Remove export from `index.ts`.
- Delete `test/idempotency.test.ts`.

### Test Changes

**New tests** (lambda-utils):
- `putIfNotExists`: returns true on first call, false on duplicate, throws on non-conditional errors
- `guardedWrite`: returns true on first call, false on duplicate (guard marker exists), throws on other transaction failures

**Removed tests**:
- `libs/lambda-utils/test/idempotency.test.ts` (7 tests)

**Updated tests** (per service):
Every event-listener test that mocks `idempotencyGuard.ensureOnce`:
- Remove mock setup for `idempotencyGuard`
- Remove `idempotencyGuard` from deps construction
- For "duplicate event" test cases: mock the repository method to return `false` from `putIfNotExists` (or throw `ConditionalCheckFailedException`)
- For lifecycle service tests: mock `createXxx` to return `false` to test skip-on-duplicate behavior

Every pipe test that mocks `idempotencyGuard`:
- Remove `idempotencyGuard` from constructor args
- Adjust duplicate-detection test cases to verify `putIfNotExists` skip behavior

## Semantics Preservation

The new approach has the **same semantics** as the current IdempotencyGuard:

| Scenario | Current behavior | New behavior |
|----------|-----------------|-------------|
| First event delivery | Guard writes marker → business logic runs | Business logic runs (conditional write succeeds) |
| Duplicate event | Guard returns false → skip | Conditional write fails → skip |
| Crash after guard, before business | Marker exists → skip on retry (event lost) | N/A — no separate marker step |
| Crash after business write started | Marker exists → skip on retry | Business record exists → skip on retry |
| Crash between business writes | Partially completed, retry skipped | Partially completed, retry skipped |

**Key improvement**: Eliminates the "crash after guard, before business" failure mode. With the old approach, the IdempotencyGuard marker could be written but the business logic never ran — the event was silently lost. With the new approach, the guard IS the business write, so this failure mode disappears.

## Migration Order

Process by risk (safest first):

1. **lambda-utils + platform-core**: Add `putIfNotExists` and `guardedWrite` (additive, no breaking changes)
2. **BFF services** (investor-bff, advisory-bff, dashboard-bff, ledger-bff): Lowest risk — read-model materialization, all writes are upserts or conditional creates
3. **Controller services** (advisory-ctrl, compliance-ctrl, investor-ctrl, execution-ctrl): Medium risk — replace `getUUID()` with event-derived IDs
4. **execution-adpt + ledger-ctrl**: Highest risk — additive operations, ledger key restructuring
5. **Cleanup**: Delete `IdempotencyGuard` class, tests, remove all imports

## Out of Scope

- Retry semantics for partially-completed lifecycle operations (same gap exists today with IdempotencyGuard)
- SQS FIFO deduplication (complementary, not a replacement)
- DynamoDB Streams idempotency (separate concern, handled by stream consumer logic)
