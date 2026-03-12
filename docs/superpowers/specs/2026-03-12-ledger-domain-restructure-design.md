# Ledger Domain Restructure — Design Spec

## Problem Statement

Financial state is currently split across two domains with inconsistent sourcing:

- **investor-bff** (Investor domain): Maintains a mutable `CashBalance` entity — no event log, no audit trail, updated via pipes from raw financial events (`DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `ORDER_FILLED`).
- **order-ledger-bff** (Execution domain): Event-sources `cashBalanceCents` + positions via `command-core` commands — full audit trail, time-travel, simulation comparison.

Both independently consume the same raw financial events and maintain separate state. For a system handling money, two sources of truth is zero sources of truth. They can drift, and there is no reconciliation mechanism between them.

## Solution

Introduce a **Ledger domain** — a new bounded context that owns the single event-sourced source of truth for all financial state (cash balance, positions, transaction history). The existing investor and execution domains stop maintaining independent financial state and instead consume authoritative events (`BALANCE_UPDATED`, `PORTFOLIO_UPDATED`) from the Ledger domain.

## Architecture Decision: Why a Separate Domain?

Three options were evaluated:

1. **Add balance-ctrl to Investor domain** — Rejected. Creates a second event-sourced system tracking the same financial reality. Two sources of truth for money.
2. **Keep financial state in Execution domain** — Rejected. "Execution" is about routing orders to market. The financial ledger is its own bounded context, independent of order lifecycle.
3. **New Ledger domain** — Selected. Clean separation: Investor owns identity/preferences, Execution owns order lifecycle, Ledger owns financial truth. Matches how banks separate account management from trade execution.

## 4-Domain Architecture

### Investor Domain — "Who is the investor?"

| Service | Role | Change |
|---------|------|--------|
| investor-web | Shell app, Cognito auth, MFE host | None |
| investor-bff | Profile, goals, mandates, risk profiles, notifications, onboarding | Drops `CashBalance`/`Deposit`/`Withdrawal` entities and related pipes. Consumes `BALANCE_UPDATED` from ledger-hub — stores read-only `balanceCents` projection for investor-mfe queries. |
| investor-ctrl | Notification lifecycle | Adds `BALANCE_UPDATED` as a notification trigger |
| dashboard-bff | Cross-domain read-model aggregator | Consumes `BALANCE_UPDATED`/`PORTFOLIO_UPDATED` from ledger-hub instead of raw financial events |
| investor-hub | EventBridge bus | Drops financial event forwarding to execution. Receives `BALANCE_UPDATED`/`PORTFOLIO_UPDATED` from ledger-hub. |

### Advisory Domain — "What should we do?" (Services unchanged, hub routing updated)

| Service | Role | Change |
|---------|------|--------|
| advisory-ctrl | Decision lifecycle, LangGraph agents | None |
| advisory-bff | Decision read-model, user confirmations | None |
| compliance-ctrl | Mandate validation, guardrails | None |
| advisory-hub | EventBridge bus | Ingress change: receives `PORTFOLIO_UPDATED` from ledger-hub instead of raw `ORDER_FILLED` from execution-hub. Egress unchanged. |

### Execution Domain — "How do we execute?" (Shrunk)

| Service | Role | Change |
|---------|------|--------|
| execution-ctrl | Order state machine (submit/stage/fill/reject/cancel) | None |
| execution-adpt | Virtual broker / market simulation. Simulates bank deposit confirmation (`DEPOSIT_DETECTED`), withdrawal processing (`WITHDRAWAL_COMPLETED`), and order fills (`ORDER_FILLED`). In production, replaced by real broker adapter. | None |
| execution-hub | EventBridge bus | Financial events now forward to ledger-hub instead of investor-hub |

Removed from execution:
- ~~portfolio-ctrl~~ → becomes `ledger/reconciliation-ctrl`
- ~~portfolio-bff~~ → deleted (queries move to `ledger/ledger-bff`)
- ~~order-ledger-bff~~ → becomes `ledger/ledger-ctrl`

### Ledger Domain — "What is the financial truth?" (New)

| Service | Role |
|---------|------|
| ledger-ctrl | Event-sourced financial ledger. Single `AccountState` aggregate per tenant (cash + positions). Reducer + Egress on DDB stream (2 consumers — at the AWS hard limit). Emits `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`. Handles both actual and simulated streams. |
| ledger-bff | Financial queries: balance, portfolio, positions, performance, order history, time-travel, simulation comparison. Own DDB table populated via events from ledger-ctrl. 6 JS pipeline resolvers + 2 Lambda resolvers. |
| reconciliation-ctrl | Drift detection, broker-to-ledger reconciliation. Emits `RECONCILIATION_COMPLETED/FAILED`, `PORTFOLIO_DRIFT_DETECTED`. |
| ledger-hub | EventBridge bus |

### Service Count

Net count unchanged (13 services). 2 services move from execution to ledger, 1 deleted from execution, 1 new in ledger.

| Domain | Before | After |
|--------|--------|-------|
| Investor | 5 services + hub | 5 services + hub |
| Advisory | 3 services + hub | 3 services + hub |
| Execution | 5 services + hub | 2 services + hub (-3: portfolio-bff deleted, portfolio-ctrl + order-ledger-bff moved) |
| Ledger | — | 3 services + hub (+3: ledger-ctrl + reconciliation-ctrl moved in, ledger-bff new) |
| **Total** | **13 + 3 hubs** | **13 + 4 hubs** |

## Architectural Rule: 1 Actor → 1 MFE → 1 BFF

Each user-facing micro-frontend (MFE) communicates with exactly one backend-for-frontend (BFF) via a single AppSync endpoint. An MFE must never query multiple BFFs directly. If an MFE needs data owned by another domain, its paired BFF consumes events and maintains a read-only projection.

This rule must be documented in `specifications/03-event-driven-architecture.md`.

### MFE-BFF Pairing (unchanged 1:1)

| MFE | BFF | Port |
|-----|-----|------|
| investor-mfe | investor-bff | 4201 |
| dashboard-mfe | dashboard-bff | 4202 |
| advisory-mfe | advisory-bff | 4203 |
| ledger-mfe | ledger-bff | 4204 |

investor-mfe displays balance by querying investor-bff, which stores a read-only `balanceCents` projected from `BALANCE_UPDATED`. This is a standard CQRS read-model projection, not independent financial state computation.

## ledger-ctrl: Detailed Design

### Events Consumed

| Event | Source Service | Source Bus | State Change |
|-------|---------------|-----------|-------------|
| DEPOSIT_DETECTED | execution-adpt (simulates bank confirmation) | execution-hub → ledger-hub | +cashBalanceCents |
| WITHDRAWAL_COMPLETED | execution-adpt (simulates bank processing) | execution-hub → ledger-hub | -cashBalanceCents |
| ORDER_FILLED | execution-ctrl | execution-hub → ledger-hub | ±cashBalanceCents, ±positions |
| ORDER_PARTIALLY_FILLED | execution-ctrl | execution-hub → ledger-hub | ±cashBalanceCents, ±positions |
| ORDER_REJECTED | execution-ctrl | execution-hub → ledger-hub | Logged to event stream (no state change — reserved cash released by execution-ctrl) |
| ORDER_CANCELLED | execution-ctrl | execution-hub → ledger-hub | Logged to event stream (no state change — reserved cash released by execution-ctrl) |
| CORPORATE_ACTION_PROCESSED | reconciliation-ctrl | ledger-hub (internal) | ±positions (splits, dividends). Reconciliation-ctrl receives raw CORPORATE_ACTION_APPLIED from execution-hub, validates it, and publishes CORPORATE_ACTION_PROCESSED on ledger-hub for ledger-ctrl to apply. |
| DECISION_PACKET_CREATED | advisory-ctrl | advisory-hub → ledger-hub | Simulated stream only (shadow-fill trigger) |

### Event-to-Command Mapping

The Reducer Lambda translates ingested event types to `command-core` commands:

| Event Type | Command | Notes |
|-----------|---------|-------|
| DEPOSIT_DETECTED | `RecordDeposit` | `{ amountCents }` |
| WITHDRAWAL_COMPLETED | `RecordWithdrawal` | `{ amountCents }` — throws if insufficient balance |
| ORDER_FILLED | `RecordFill` | `{ symbol, side, quantity, priceCents }` — updates cash + position |
| ORDER_PARTIALLY_FILLED | `RecordFill` | Same as ORDER_FILLED with partial quantity |
| ORDER_REJECTED | *(no command)* | Logged to event stream for audit trail, no state transition |
| ORDER_CANCELLED | *(no command)* | Logged to event stream for audit trail, no state transition |
| CORPORATE_ACTION_PROCESSED | `RecordCorporateAction` | New command — adjusts position quantity/cost basis for splits/dividends |
| DECISION_PACKET_CREATED | *(simulation)* | Triggers shadow-fill into simulated stream |

### State Model (AccountState)

Extends the existing `command-core` pattern. Single aggregate per tenant. The type is renamed from `PortfolioState` → `AccountState` but **preserves all existing fields**:

```typescript
interface AccountState {
  readonly cashBalanceCents: number;
  readonly positions: Readonly<Record<string, PositionState>>;
  readonly lastEventSequence: number;
}

interface PositionState {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;    // preserved from existing PortfolioState
  readonly totalCostBasis: number;      // preserved — needed for P&L calculations
  readonly lastFillPrice: number;       // preserved — needed for current value estimation
}

const INITIAL_ACCOUNT_STATE: AccountState = {
  positions: {},
  cashBalanceCents: 10_000_000, // $100k starting balance
  lastEventSequence: 0,
};
```

All 5 existing commands that reference `PortfolioState` must be updated to reference `AccountState`: `RecordDeposit`, `RecordWithdrawal`, `RecordFill`, `SubmitOrder`, `CancelOrder`. This is a type rename, not a logic change.

### DynamoDB Table Layout

```
pk: Account#{tenantId}#{streamType}     sk: Event#{sequenceNo}#{eventId}       → LedgerEntry
pk: Account#{tenantId}#{streamType}     sk: Snapshot#latest                    → AccountState
pk: Account#{tenantId}#{streamType}     sk: Checkpoint#{date}                  → AccountState
pk: Sequence#{tenantId}#{streamType}    sk: Counter                            → atomic sequence counter
```

`streamType` is `actual` or `simulated` — same dual-stream pattern as current order-ledger-bff.

### Lambda Architecture

Two Lambdas + two DynamoDB Stream consumers (at the AWS hard limit of 2 per stream):

```
EventBridge → SQS → EventListener Lambda
  → IdempotencyGuard.ensureOnce(eventType, eventId)
  → Validates event payload (Zod schema per event type)
  → Assigns sequence number (atomic increment on Sequence# counter)
  → Writes LedgerEntry to DDB
  → Publishes metrics: EventProcessed / EventFailed

DDB Stream → Reducer Lambda (FilterCriteria: INSERT + __typename=LedgerEntry)
  → Loads Snapshot#latest
  → Maps event type to command-core command (see Event-to-Command Mapping)
  → Applies command via applyCommand() (validates, transitions state)
  → Writes updated Snapshot#latest
  → Writes Checkpoint#{date} on first event of each new day
    (conditional PutItem with attribute_not_exists(sk) on Checkpoint key)
  → Writes BalanceEvent record if cashBalanceCents changed
  → Writes PortfolioEvent record if positions changed
  → Writes LedgerEntryEvent record for every event (triggers Egress)
  → Publishes metrics: ReducerProcessed / ReducerFailed

DDB Stream → Egress Lambda (FilterCriteria: INSERT + __typename=BalanceEvent|PortfolioEvent|LedgerEntryEvent)
  → Publishes BALANCE_UPDATED / PORTFOLIO_UPDATED / LEDGER_ENTRY_RECORDED to ledger-hub
```

### Events Emitted

| Event | Trigger | Payload |
|-------|---------|---------|
| BALANCE_UPDATED | Any event that changes cashBalanceCents | `{ tenantId, balanceCents, deltaCents, causeEventType, causeEventId }` |
| PORTFOLIO_UPDATED | Any event that changes positions | `{ tenantId, positions, changedSymbols[], causeEventType, causeEventId }` |
| LEDGER_ENTRY_RECORDED | Every event ingested | `{ tenantId, streamType, sequenceNo, eventType, payload, timestamp }` |

An `ORDER_FILLED` emits all three. A `DEPOSIT_DETECTED` emits `BALANCE_UPDATED` + `LEDGER_ENTRY_RECORDED`. An `ORDER_REJECTED` emits only `LEDGER_ENTRY_RECORDED` (audit trail, no state change).

### Error Events

| Event | Trigger | Payload | Consumers |
|-------|---------|---------|-----------|
| LEDGER_PROCESSING_FAILED | EventListener or Reducer Lambda unrecoverable error | `{ tenantId, causeEventType, causeEventId, error, timestamp }` | dashboard-bff (alert display), investor-ctrl (notification) |

### Resilience Configuration

All Lambdas follow the project-wide resilience pattern:

| Setting | EventListener | Reducer |
|---------|--------------|---------|
| MaximumRetryAttempts | 3 | 3 |
| BisectBatchOnFunctionError | N/A (SQS source) | true |
| ReportBatchItemFailures | N/A (SQS source) | true |
| DLQ | SQS DLQ (14-day retention) | SQS on-failure destination (14-day retention) |
| Idempotency | IdempotencyGuard.ensureOnce() | Idempotent by design (snapshot overwrite) |
| Batch size | 10 (SQS default) | 100 (DDB stream) |

### AWS Hard Limit: 2 DDB Stream Consumers

DynamoDB Streams supports a maximum of 2 concurrent Lambda consumers per stream shard. ledger-ctrl uses exactly 2: Reducer + Egress. This was the deciding factor for choosing a single aggregate reducer (Approach 1) over dual reducers (Approach 3), which would have required 3 consumers.

Failure isolation between consumers: each maintains independent iterators/checkpoints. A stuck consumer does not block the other's progress, though they share shard read throughput.

### Monitoring

Uses the project-wide `Monitoring` and `ServiceDashboard` CDK constructs:

- Custom metrics: `EventProcessed`, `EventFailed`, `ReducerProcessed`, `ReducerFailed` (via `createServiceMetrics`)
- ServiceDashboard: Lambda invocations/errors/duration, DLQ depth, EventBridge delivery metrics
- X-Ray: `traceEvent()` annotations on EventType, EventId, TenantId
- Log retention: 90 days (`RetentionDays.THREE_MONTHS`)

## ledger-bff: Detailed Design

### Events Consumed

| Event | Source | What it writes |
|-------|--------|---------------|
| BALANCE_UPDATED | ledger-ctrl | Updates `Portfolio#latest` cash fields |
| PORTFOLIO_UPDATED | ledger-ctrl | Updates `Position#{symbol}` records |
| LEDGER_ENTRY_RECORDED | ledger-ctrl | Appends to `History#` for transaction log + materializes `Checkpoint#` snapshots for time-travel |

### Events Published

None. Pure read-model.

### DynamoDB Table Layout

```
pk: Portfolio#{tenantId}           sk: Latest                    → current AccountState (cash + position summary)
pk: Portfolio#{tenantId}           sk: Position#{symbol}          → individual position record
pk: History#{tenantId}             sk: #{sequenceNo}#{eventId}    → raw ledger entry (for replay + order history)
pk: Checkpoint#{tenantId}          sk: #{date}                    → point-in-time snapshot (for time-travel)
pk: Simulation#{tenantId}          sk: Latest                    → simulated AccountState
pk: Simulation#{tenantId}          sk: Position#{symbol}          → simulated position
```

### Checkpoint Strategy

The EventListener materializes checkpoints when processing the first `LEDGER_ENTRY_RECORDED` of a new day. Detection: conditional `PutItem` with `attribute_not_exists(sk)` on `Checkpoint#{tenantId}##{date}`. If the write succeeds, snapshot the current `Portfolio#latest` state into the checkpoint. If it fails (condition not met), skip — checkpoint already exists for today.

Time-travel queries replay from the nearest checkpoint forward through `History#` entries.

### GraphQL Operations

| Operation | Type | Resolver | Description |
|-----------|------|----------|-------------|
| getBalance | Query | JS pipeline | Read Portfolio#latest cash fields |
| getPortfolio | Query | JS pipeline | Read Portfolio#latest full state |
| getPositions | Query | JS pipeline | Query Position#{symbol} records |
| getPerformance | Query | JS pipeline | Computed from Portfolio#latest |
| getOrderHistory | Query | JS pipeline | Paginated scan on History#{tenantId} |
| getTimeTravelAvailability | Query | JS pipeline | Scan Checkpoint# for date range |
| getPortfolioAt | Query | Lambda | Loads nearest checkpoint + replays History# entries to target timestamp |
| getSimulationComparison | Query | Lambda | Parallel reads: Portfolio#latest vs Simulation#latest, diffs |

8 operations: 6 JS pipeline + 2 Lambda resolvers.

### Lambda Architecture

```
ledger-hub → SQS → EventListener Lambda
  → IdempotencyGuard.ensureOnce(eventType, eventId)
  → processes BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED
  → writes to own DDB table
  → Publishes metrics: EventProcessed / EventFailed

AppSync → JS pipeline resolvers (6 queries)
AppSync → Resolver Lambda (getPortfolioAt, getSimulationComparison)
```

### Monitoring

Same pattern as ledger-ctrl: `Monitoring` + `ServiceDashboard` constructs, `createServiceMetrics`, `traceEvent()`, 90-day log retention.

## reconciliation-ctrl: Detailed Design

### Events Consumed

| Event | Source Service | Source Bus | Purpose |
|-------|---------------|-----------|---------|
| PORTFOLIO_UPDATED | ledger-ctrl | ledger-hub (internal) | Triggers reconciliation check against broker state |
| PORTFOLIO_SNAPSHOT_IMPORTED | execution-adpt (broker feed simulation) | execution-hub → ledger-hub | Broker's view of positions to compare |
| CORPORATE_ACTION_APPLIED | execution-adpt (broker feed simulation) | execution-hub → ledger-hub | Stock splits, dividends (expected drift) |

Note: `PORTFOLIO_SNAPSHOT_IMPORTED` and `CORPORATE_ACTION_APPLIED` originate from execution-adpt, which simulates broker feeds. In production, these would come from a real broker adapter. They flow: execution-adpt → execution-hub → ledger-hub → reconciliation-ctrl. reconciliation-ctrl validates corporate actions and publishes `CORPORATE_ACTION_PROCESSED` on ledger-hub, which ledger-ctrl consumes to apply position adjustments.

### Events Published

| Event | Payload | Consumers |
|-------|---------|-----------|
| RECONCILIATION_COMPLETED | `{ tenantId, matchedPositions, timestamp }` | dashboard-bff |
| RECONCILIATION_FAILED | `{ tenantId, driftRecords[], severity }` | dashboard-bff, advisory-ctrl |
| PORTFOLIO_DRIFT_DETECTED | `{ tenantId, symbol, expectedQty, actualQty, driftPercent }` | advisory-ctrl |
| CORPORATE_ACTION_PROCESSED | `{ tenantId, symbol, actionType, adjustedQuantity, adjustedCostBasis }` | ledger-ctrl |

### DynamoDB Table Layout

```
pk: Reconciliation#{tenantId}      sk: #{timestamp}                → reconciliation result
pk: Drift#{tenantId}               sk: #{symbol}#{timestamp}       → individual drift record
pk: BrokerSnapshot#{tenantId}      sk: Latest                     → last imported broker state
```

### Lambda Architecture

Standard 2-Lambda pattern (EventListener + Egress). No GraphQL. Same monitoring pattern.

## ledger-hub: Event Routing

### Bus

`nestfolio-${stage}-ledger-bus`

SSM parameter: `/nestfolio/${prefix}-ledger/event-hub/busArn`

### CDK Configuration

Follows the same hub pattern as investor-hub, advisory-hub, execution-hub:
- EventBridge archive (7-day retention) for replay capability
- Per-target SQS DLQs with CloudWatch alarms
- `Monitoring` construct for bus-level metrics
- `ServiceDashboard` construct

### Ingress Rules (events into ledger-hub)

| Source Bus | Events | Target Service |
|-----------|--------|----------------|
| execution-hub | ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED | ledger-ctrl |
| execution-hub | DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED | ledger-ctrl |
| execution-hub | CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED | reconciliation-ctrl |
| advisory-hub | DECISION_PACKET_CREATED | ledger-ctrl (simulated stream) |

### Egress Rules (events out of ledger-hub)

| Event | Target Bus | Consumers |
|-------|-----------|-----------|
| BALANCE_UPDATED | investor-hub | dashboard-bff, investor-bff, investor-ctrl |
| PORTFOLIO_UPDATED | investor-hub | dashboard-bff |
| PORTFOLIO_UPDATED | advisory-hub | advisory-ctrl |
| LEDGER_ENTRY_RECORDED | *(stays on ledger-hub)* | ledger-bff |
| RECONCILIATION_COMPLETED | investor-hub | dashboard-bff |
| RECONCILIATION_FAILED | investor-hub, advisory-hub | dashboard-bff, advisory-ctrl |
| PORTFOLIO_DRIFT_DETECTED | advisory-hub | advisory-ctrl |
| CORPORATE_ACTION_PROCESSED | *(stays on ledger-hub)* | ledger-ctrl |
| LEDGER_PROCESSING_FAILED | investor-hub | dashboard-bff, investor-ctrl |

### Changes to Existing Hubs

**execution-hub**: Removes forwarding of financial events to investor-hub. Adds forwarding to ledger-hub instead. Keeps ORDER_FILLED/ORDER_REJECTED/ORDER_CANCELLED forwarding to advisory-hub (decision feedback, not financial state).

**investor-hub**: No longer receives raw financial events from execution. Receives BALANCE_UPDATED/PORTFOLIO_UPDATED/LEDGER_PROCESSING_FAILED from ledger-hub. Forwarding to advisory-hub (goals, mandates, risk profiles) and execution-hub (deposit/withdrawal requests) unchanged.

**advisory-hub**: Receives PORTFOLIO_UPDATED from ledger-hub instead of raw ORDER_FILLED from execution-hub for portfolio context. Forwarding to execution-hub and investor-hub unchanged.

## command-core Library Changes

### Folder Restructure

```
libs/command-core/src/commands/
  ledger/                        (renamed from execution/)
    record-deposit.ts              (logic unchanged, type: AccountState)
    record-withdrawal.ts           (logic unchanged, type: AccountState)
    record-fill.ts                 (logic unchanged, type: AccountState)
    record-corporate-action.ts     (NEW — position adjustments for splits/dividends)
  order/                         (NEW folder for order lifecycle)
    submit-order.ts                (moved from execution/, type updated: PortfolioState → AccountState)
    cancel-order.ts                (moved from execution/, type updated: PortfolioState → AccountState)
```

### Type Rename

`PortfolioState` → `AccountState`, `INITIAL_PORTFOLIO_STATE` → `INITIAL_ACCOUNT_STATE`. Same shape, all fields preserved. All 5 commands referencing `PortfolioState` updated to `AccountState`. This is a type rename across the following files:

- `libs/command-core/src/state/portfolio-state.ts` → `account-state.ts`
- `libs/command-core/src/commands/ledger/record-deposit.ts`
- `libs/command-core/src/commands/ledger/record-withdrawal.ts`
- `libs/command-core/src/commands/ledger/record-fill.ts`
- `libs/command-core/src/reducer.ts` (generic — type parameter changes at call sites)

## Data Migration Strategy

This is a POC/system design phase. No production data exists. The approach is **fresh start**:

- ledger-ctrl starts with empty DDB table and `INITIAL_ACCOUNT_STATE`
- ledger-bff starts with empty DDB table
- reconciliation-ctrl starts with empty DDB table
- order-ledger-bff's existing test data and DDB table are not migrated
- investor-bff's CashBalance/Deposit/Withdrawal entities are simply deleted (code + tests)
- portfolio-bff and portfolio-ctrl test data is not migrated

If a backfill is ever needed in production, the EventBridge archive (7-day retention on all hubs) can replay events, or a DDB export/import from order-ledger-bff's table can seed the ledger.

## Nx Workspace Changes

### New Directory Structure

```
services/ledger/
  ledger-ctrl/        (new project, based on order-ledger-bff patterns)
  ledger-bff/         (new project)
  reconciliation-ctrl/ (moved from services/execution/portfolio-ctrl/)
  ledger-hub/         (new project, based on existing hub patterns)
```

### Project Configuration

Each new service gets a `project.json` with:
- `name`: `ledger-ctrl`, `ledger-bff`, `reconciliation-ctrl`, `ledger-hub`
- `tags`: `["domain:ledger", "type:service"]` (or `type:hub` for ledger-hub)
- Standard targets: `build`, `test`, `lint`, `cdk-synth`

### Removed Projects

- `services/execution/portfolio-bff/` — deleted (project.json, src/, tests)
- `services/execution/order-ledger-bff/` — deleted after ledger-ctrl is built
- `services/execution/portfolio-ctrl/` — deleted after reconciliation-ctrl is built

### Import Path Updates

- `@nestfolio/command-core` — internal paths change (commands/execution/ → commands/ledger/ + commands/order/)
- No cross-service import paths affected (services don't import from each other)

## Test Impact

### Tests That Move (rewritten for new service context)

| Source | Destination | Approximate Count |
|--------|------------|-------------------|
| order-ledger-bff tests | ledger-ctrl tests + ledger-bff tests | ~45 tests split |
| portfolio-ctrl tests | reconciliation-ctrl tests | ~20 tests |
| portfolio-bff tests | ledger-bff tests (merged with above) | ~15 tests |

### Tests That Change

| Service | Change | Approximate Count |
|---------|--------|-------------------|
| investor-bff | Remove CashBalance/Deposit/Withdrawal pipe tests. Add BALANCE_UPDATED projection test. | -8, +2 |
| dashboard-bff | Update event listener tests (BALANCE_UPDATED/PORTFOLIO_UPDATED instead of raw events) | ~10 rewritten |
| command-core | Update type references (PortfolioState → AccountState), add RecordCorporateAction tests | ~5 updated, +3 new |

### Tests Deleted

| Service | Reason |
|---------|--------|
| portfolio-bff (all) | Service deleted |

### New Tests

| Service | Description | Approximate Count |
|---------|-------------|-------------------|
| ledger-ctrl | EventListener, Reducer, event-to-command mapping, idempotency, dual-stream, checkpoint | ~30 |
| ledger-bff | EventListener projections, GraphQL resolvers, time-travel, simulation comparison | ~25 |
| reconciliation-ctrl | Drift detection, reconciliation logic (moved + adapted from portfolio-ctrl) | ~20 |
| ledger-hub | Forwarding rules, CDK stack synthesis | ~5 |

## Implementation Sequence

### Phase 1: Foundation (no existing service changes)

1. Create `services/ledger/` directory structure
2. Rename command-core types (`PortfolioState` → `AccountState`, folder restructure)
3. Add `RecordCorporateAction` command to command-core
4. Build `ledger-hub` CDK stack (bus, SSM parameter, archive, DLQs)
5. Build `ledger-ctrl` (EventListener + Reducer + Egress, all tests)
6. Build `ledger-bff` (EventListener + GraphQL resolvers, all tests)
7. Build `reconciliation-ctrl` (moved + adapted from portfolio-ctrl)

### Phase 2: Rewire existing services

8. Update `execution-hub` forwarding rules (financial events → ledger-hub)
9. Update `advisory-hub` ingress (PORTFOLIO_UPDATED from ledger-hub)
10. Update `investor-hub` ingress (BALANCE_UPDATED/PORTFOLIO_UPDATED from ledger-hub)
11. Update `investor-bff` — remove financial pipes, add BALANCE_UPDATED consumer
12. Update `dashboard-bff` — consume BALANCE_UPDATED/PORTFOLIO_UPDATED instead of raw events
13. Update `ledger-mfe` AppSync endpoint configuration

### Phase 3: Cleanup

14. Delete `services/execution/portfolio-bff/`
15. Delete `services/execution/order-ledger-bff/`
16. Delete `services/execution/portfolio-ctrl/`
17. Update `specifications/03-event-driven-architecture.md` with 1:1 MFE-BFF rule
18. Verify all tests pass across all projects

Phase 1 can proceed independently. Phase 2 tasks 8-13 can be parallelized. Phase 3 depends on Phase 2 completion.

## Migration Impact Summary

### Services That Move

| Current Location | New Location | Transformation |
|-----------------|-------------|----------------|
| execution/order-ledger-bff | ledger/ledger-ctrl | Rewritten: drops GraphQL, adds BALANCE_UPDATED/PORTFOLIO_UPDATED/LEDGER_ENTRY_RECORDED emission, adds DEPOSIT_DETECTED/WITHDRAWAL_COMPLETED handling, adds ORDER_REJECTED/ORDER_CANCELLED audit logging |
| execution/portfolio-ctrl | ledger/reconciliation-ctrl | Moved + renamed: drops portfolio state management, keeps reconciliation + drift detection only |

### New Services

| Service | Description |
|---------|-------------|
| ledger/ledger-bff | Financial queries with own DDB table, populated via events from ledger-ctrl |
| ledger/ledger-hub | New EventBridge bus with cross-domain forwarding rules |

### Deleted Services

| Service | Reason |
|---------|--------|
| execution/portfolio-bff | All queries move to ledger-bff |

### Shrunk Services

| Service | Removed |
|---------|---------|
| investor-bff | CashBalance/Deposit/Withdrawal entities, DepositDetectedPipe, WithdrawalCompletedPipe, updateCashBalanceFromFill(). Adds: BALANCE_UPDATED consumer for read-only balanceCents projection. |
| dashboard-bff | Drops raw financial event consumption. Consumes BALANCE_UPDATED/PORTFOLIO_UPDATED instead. |

### Unchanged Services

investor-web, investor-ctrl (adds BALANCE_UPDATED trigger), advisory-ctrl, advisory-bff, compliance-ctrl, execution-ctrl, execution-adpt.

### Frontend Impact

| MFE | Change |
|-----|--------|
| ledger-mfe | AppSync endpoint: order-ledger-bff → ledger-bff |
| investor-mfe | Balance queries stay on investor-bff (read-only projection) |
| dashboard-mfe | No change |
| advisory-mfe | No change |
