# Resilience Integration Tests — Idempotency & Order-Agnostic

**Date:** 2026-04-10
**Status:** Draft

## Goal

Add integration tests that verify two properties across financial-critical services:

1. **Idempotency** — processing the same event twice produces the same state as processing it once (no duplicate records, no double-counting, no duplicate CDC emissions)
2. **Order-agnostic** — events arriving in any order produce the correct final state (no stale overwrites, no missing state, no broken reducers)

## Scope

### Services Under Test

Six stateful financial-critical services. Two stateless adapters (ledger-adpt, execution-adpt) are excluded — they are pure EventBridge rule forwarding with no handlers or DynamoDB writes. Their resilience is an e2e concern (future work).

| Service | Domain | Key Risk | WriteIntent / Pattern |
|---------|--------|----------|----------------------|
| `ledger-ctrl` | Ledger | Highest — atomic counters, reducer snapshots, tax lots. Bypasses event-processor dedup (uses `skip()` + direct repository writes) | Repository-level PutCommand with condition, ADD for sequence counter, replayAndReduce for snapshots |
| `reconciliation-ctrl` | Ledger | Medium — RecordIntent with eventId in SK | `record()` for ReconciliationResult + DriftRecord |
| `execution-ctrl` | Execution | Medium — staged orders, circuit breaker state | `record()` for Order + StagedOrder |
| `broker-ctrl` | Execution | Medium-high — SF callbacks, deposit/withdrawal normalization | `record()` for ExecutionMode + NormalizedEvent, `skip()` for SF callbacks |
| `broker-alpaca-adpt` | Execution | Medium — external API calls happen before dedup | `record()` for AlpacaOrderResult + AlpacaTransferResult |
| `portfolio-engine-ctrl` | Advisory | Medium — agent invocation happens before dedup | `record()` for AgentInvocation, `store()` for KB ingestion |

### Library-Level Primitive Tests

Added to `libs/event-processor/test/integration/` — verify that each WriteIntent type handles duplicates correctly under real AWS conditions:

- **RecordIntent**: eventId in SK + `attribute_not_exists` condition → second write returns `deduplicated`
- **AccumulateIntent + guardedWrite**: guard marker `ProcessedEvent#{eventId}` prevents double ADD
- **ProjectIntent**: unconditional PutItem → overwrite is harmless (same data)
- **UpdateIntent with condition**: condition prevents double-apply
- **StoreIntent**: deterministic S3 key → overwrite is harmless

These prove the primitives once so per-service tests don't need to re-verify them.

## Test Mechanics

### Idempotency: Publish-Wait-Replay-Assert

```
1. Publish event with eventId-A → EventBridge
2. waitForItem() — wait for DDB state to settle
3. Publish exact same event (same eventId-A) again
4. Wait 10s for second event to be processed (or deduplicated)
5. Assert:
   - Item count unchanged (query by pk, count records)
   - Counter values unchanged (for AccumulateIntent services)
   - No duplicate CDC events (EventBusTrap count assertion)
```

### Order-Agnostic: Final-State Equivalence (financial-critical)

```
1. tenantId-A (ordered run):
   - Publish events [E1, E2, E3] in chronological order
   - waitForItem() after each
   - Snapshot final DDB state

2. tenantId-B (shuffled run):
   - Publish events [E3, E1, E2] (reversed / shuffled)
   - waitForItem() after last settles
   - Snapshot final DDB state

3. Assert: final states equivalent
   - Field-by-field comparison
   - Exclude: tenantId, createdAt, updatedAt, pk, sk, eventId
   - Include: all business fields (balance, quantity, status, etc.)
```

### Order-Agnostic: Pairwise Inversion (all services)

```
1. tenantId-A: Publish [EventA, EventB] in order → snapshot state
2. tenantId-B: Publish [EventB, EventA] reversed → snapshot state
3. Assert: final states equivalent (same exclusions as above)
```

### Isolation

- Each test scenario gets unique `integ-{timestamp}-{scenario}` tenantId
- No cross-contamination between idempotency and ordering tests
- CleanupRegistry handles teardown

## Per-Service Scenarios

### ledger-ctrl (Highest Priority)

**Critical context:** This service uses `skip()` in its event-listener handler and delegates all persistence to `ledger.repository.ts` with direct DynamoDB commands. It does NOT use RecordIntent's built-in deduplication. The repository uses:
- `PutCommand` with `attribute_not_exists(pk)` condition for LedgerEntry (eventId in SK)
- Atomic `ADD` for sequence counter (`Sequence#{tenantId}#actual` / `Counter`)
- `replayAndReduce` for AccountSnapshot materialization

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate fill | `ORDER_FILLED` ×2 (same eventId) | Single LedgerEntry, sequence counter incremented once, single BALANCE_UPDATED CDC |
| Duplicate deposit | `DEPOSIT_DETECTED` ×2 (same eventId) | Single LedgerEntry, balance reflects one deposit |
| Duplicate simulation | `DECISION_PACKET_CREATED` ×2 (same eventId) | Single set of simulated LedgerEntries |

**Order-agnostic tests (full shuffle):**

| Test | Events (ordered) | Events (shuffled) | Assert |
|------|------------------|--------------------|--------|
| Mixed fills | `ORDER_FILLED(AAPL)` → `ORDER_FILLED(MSFT)` → `DEPOSIT_DETECTED` | Reverse | Same final AccountSnapshot (cashBalance, positions) |
| Partial + full fill | `ORDER_PARTIALLY_FILLED` → `ORDER_FILLED` | Reverse | Same final LedgerEntry set, same snapshot |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Fill then reject | `ORDER_FILLED` → `ORDER_REJECTED` vs reverse | Same final state (both recorded independently) |
| Deposit then withdrawal | `DEPOSIT_DETECTED` → `WITHDRAWAL_COMPLETED` vs reverse | Same final cashBalance in snapshot |

### reconciliation-ctrl

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate reconciliation | `PORTFOLIO_UPDATED` ×2 (same eventId) | Single ReconciliationResult, single set of DriftRecords |
| Duplicate snapshot | `ALPACA_ACCOUNT_SNAPSHOT` ×2 (same eventId) | Single ReconciliationResult |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Portfolio then snapshot | `PORTFOLIO_UPDATED` → `ALPACA_ACCOUNT_SNAPSHOT` vs reverse | Both produce independent ReconciliationResults — order doesn't affect outcome (events are independent) |

### execution-ctrl

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate approval | `DECISION_APPROVED` ×2 (same eventId) | Single Order + single StagedOrder |
| Duplicate circuit breaker | `CIRCUIT_BREAKER_TRIGGERED` ×2 (same eventId) | Single circuit breaker record |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Approval then breaker | `DECISION_APPROVED` → `CIRCUIT_BREAKER_TRIGGERED` vs reverse | Both scenarios: Order exists, circuit breaker state set. (These affect different entities so ordering shouldn't matter for final state.) |

### broker-ctrl

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate mode change | `EXECUTION_MODE_CHANGED` ×2 (same eventId) | Single ExecutionMode record, same mode value |
| Duplicate deposit normalization | `SIM_DEPOSIT_COMPLETED` ×2 (same eventId) | Single NormalizedEvent, single DEPOSIT_DETECTED CDC |
| Duplicate withdrawal normalization | `SIM_WITHDRAWAL_COMPLETED` ×2 (same eventId) | Single NormalizedEvent, single WITHDRAWAL_COMPLETED CDC |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Mode then deposit | `EXECUTION_MODE_CHANGED` → `SIM_DEPOSIT_COMPLETED` vs reverse | Both produce correct records (independent entities) |
| Deposit then withdrawal | `SIM_DEPOSIT_COMPLETED` → `SIM_WITHDRAWAL_COMPLETED` vs reverse | Both NormalizedEvents created correctly regardless of order |

### broker-alpaca-adpt

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate order request | `ALPACA_ORDER_REQUESTED` ×2 (same eventId) | Single AlpacaOrderResult record. Note: the Alpaca API call may execute twice (side effect before dedup), but DDB state is correct. Mock API call count assertion via MockApiFixture. |
| Duplicate transfer request | `ALPACA_TRANSFER_REQUESTED` ×2 (same eventId) | Single AlpacaTransferResult record |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Order then cancel | `ALPACA_ORDER_REQUESTED` → `ALPACA_ORDER_CANCEL_REQUESTED` vs reverse | Both produce correct records. Cancel-before-order may fail gracefully (no order to cancel). |

### portfolio-engine-ctrl

**Idempotency tests:**

| Test | Event | Assert |
|------|-------|--------|
| Duplicate construct | `CONSTRUCT_PORTFOLIO` ×2 (same eventId) | Single AgentInvocation record. Note: agent pipeline may run twice (side effect before dedup), but DDB state is correct. |
| Duplicate KB ingestion | `SEC_PROSPECTUS_UPDATED` ×2 (same eventId) | Single S3 object (StoreIntent overwrites with same content) |

**Order-agnostic tests (pairwise inversion):**

| Test | Pair | Assert |
|------|------|--------|
| Construct then SEC filing | `CONSTRUCT_PORTFOLIO` → `SEC_PROSPECTUS_UPDATED` vs reverse | Independent events, both produce correct state regardless of order |

## File Structure

Each service gets a new test file alongside its existing integration test:

```
services/<domain>/<service>/test/integration/
  ├── <service>.integration.test.ts          # existing smoke tests
  └── <service>.resilience.integration.test.ts  # new resilience tests
```

Library-level tests:

```
libs/event-processor/test/integration/
  └── write-intent-idempotency.integration.test.ts
```

## Helper Utilities

Add to `libs/integration-testing/src/`:

### `stateSnapshot(table: TableAssertions, pk: string, skPrefix?: string): Promise<StateSnapshot>`

Queries all items under a pk, strips dynamic fields (tenantId, pk, sk, createdAt, updatedAt, eventId, ttl), and returns a normalized, comparable object.

### `assertStateEquivalence(snapshotA: StateSnapshot, snapshotB: StateSnapshot): void`

Deep-equals two state snapshots after stripping dynamic fields. Reports diff on failure.

### `publishAndWait(eb: EventBridgeClient, table: TableAssertions, event: EventInput, waitConfig: WaitConfig): Promise<void>`

Convenience: publishes event then waits for item. Reduces boilerplate in resilience tests.

### `publishDuplicate(eb: EventBridgeClient, table: TableAssertions, event: EventInput, waitConfig: WaitConfig, replayWindowMs = 10_000): Promise<void>`

Publishes event, waits for state to settle, publishes same event again, waits `replayWindowMs` for the duplicate to be processed (or deduplicated). Default 10s is sufficient for SQS → Lambda → DDB round-trip.

## Risks & Notes

1. **ledger-ctrl sequence counter** — Uses atomic ADD without guard markers. If the PutCommand condition fails (duplicate LedgerEntry), the ADD may still execute on a retry path. This needs investigation during implementation — the test may uncover a real bug.

2. **Side effects before dedup** — broker-alpaca-adpt and portfolio-engine-ctrl execute external calls (Alpaca API, Bedrock agents) before returning WriteIntents. RecordIntent deduplicates the DDB write but NOT the side effect. Integration tests verify DDB state correctness; mock APIs verify call counts.

3. **CDC event counting** — EventBusTrap captures events on a per-tenant SQS queue. For idempotency tests, we assert that only one CDC event is captured within a timeout window. A false positive is possible if the second event's CDC arrives after the assertion window closes, but a 10s wait after the replay should be sufficient.

4. **Reducer ordering in ledger-ctrl** — The `replayAndReduce` pipeline loads snapshot + queries events since `lastEventSequence`. If events arrive out of order, the reducer replays from the snapshot point forward. The full-shuffle test verifies this produces the same final snapshot.

5. **Stateless adapters** — ledger-adpt and execution-adpt are excluded from per-service tests. They forward events via EventBridge rules (no state, no handlers). Their resilience under duplication is an e2e concern — a duplicate event in = a duplicate event out. Downstream idempotency handles this.

## Out of Scope

- **Cross-domain e2e resilience** — Testing duplicate/reordered events across domain boundaries (adapter → bus → service chains). Planned as a separate effort.
- **Step Functions idempotency** — SF execution deduplication (via execution name) is an infrastructure concern, not tested at the integration level.
- **Performance under load** — These tests verify correctness, not throughput.
