# Typed-Subject Contracts — Execution (slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Execution-domain producer aggregate has a producer-owned zod subject contract (`<Name>Schema` + `type <Name>`, NO `Subject` suffix) that types both the persisted row (`TableEntry<Subject, S>`) and the emitted event (`BusEvent<Subject, S>`), validated against the **REAL** deployed/broker emission — replicating the shipped `typed-subject-contracts-ledger` + `-investor` pattern on the **live-money** Execution path.

**Architecture:** Dry-aggregate zod schemas live in each producer's `domain/contracts.ts` (imports ONLY zod). Inline/zod **row** types that re-declare `pk`/`sk`/`__typename` are replaced: the contract is the dry subject, and TS write-literals are typed `satisfies TableEntry<Subject, S>` (`S = RequestContext`, or a narrower `{ tenantId }` for tenant-only rows). The 7 existing unused zod row schemas (`BrokerOrderSchema`/`NormalizedEventSchema`/`ExecutionModeSchema`/`AlpacaOrderResultSchema`/`AlpacaTransferResultSchema`/`AlpacaAccountSnapshotSchema`/`CircuitBreakerSchema`) are removed and re-authored as dry contracts (grep proved ZERO parse-sites / type-importers outside their own `domain/` barrels). A scoped e2e drives the **SIM** order/funding path (synthetic upstream trigger → REAL producer emission) AND the **REAL Alpaca paper** order/transfer path, parsing each persisted row against its contract. Identity (`tenantId`/`userId`/`region`) is DRY — it travels in the event context, never on the subject (zod strips it).

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`TableEntry<T,S>`, `BusEvent<T,S>`, `record()`, `RequestContext`, `SubjectContext`), Nx, Jest, `@nestfolio/test-support` (e2e), AWS DynamoDB DocumentClient, real Alpaca **paper** API (`alpacaPaperReset`).

---

## Design decisions (locked by user, 2026-06-10)

1. **Cleanup scope (Q1) = FULL convention compliance.** Author dry contracts for every emitted subject AND convert ALL inline/zod row types (incl. internal non-emitted rows: `BrokerOrder` state, `ExecutionMode` cache, `VirtualCashBalance`/`VirtualPosition`/`VirtualSnapshot`, `CircuitBreaker` state) to `TableEntry<Subject>`; replace the 7 unused zod row schemas.
2. **Alpaca validation (Q2) = REAL Alpaca paper e2e.** The gate switches a tenant to **live** mode and drives a REAL Alpaca paper order + transfer (`alpacaPaperReset`) so `AlpacaOrderResult`/`AlpacaTransferResult`/`AlpacaAccountSnapshot` are validated against the REAL Alpaca emission — in addition to the SIM path. **Safety mitigations required** (see Task 5: paper-allowlist guard, SSM-cache flush, orphaned-poll-SF cleanup — surfaced by the 2026-04-10 real-paper-leak finding).
3. **Alpaca event coverage (Q3) = COMPLETE.** Also author contracts for `ALPACA_ACCOUNT_SNAPSHOT` + the circuit-breaker event (`BROKER_CIRCUIT_OPEN/CLOSED/ESCALATED`), not just order/transfer.
4. **Contract-home (locked, ledger-slice precedent).** Author every producer contract in the PRODUCER SERVICE's `domain/contracts.ts` (`@nestfolio/<svc>/contracts`). Cross-domain RE-EXPORT through `execution-adpt/domain` is **DEFERRED to WS-3** (consumer migration) — matching the shipped ledger slice (which did not touch `ledger-adpt/domain`). `execution-adpt/domain`'s existing `FundingSnapshot` stays put (out of scope). [[event-subject-contracts]]

## Conventions applied (umbrella design § "The conventions")

- **(1) parseSubject-only reads** — out of scope here (WS-3); this slice only AUTHORS contracts + converts rows.
- **(3) One subject type for row + event** — the row is `TableEntry<Subject>`, the event is `BusEvent<Subject>`; no hand-rolled/zod row interfaces re-declaring `pk/sk/__typename`.
- **(4) Clean event-aligned names** — `<Name>Schema` + `type <Name>`, no `Subject` suffix. The order-lifecycle subject is named `NormalizedOrderEvent` (event-aligned: the normalized ORDER_* lifecycle event) to disambiguate from the funding `FundingEvent` carrier.
- **(5)+(6) Context generic `S`, pure aggregates** — subjects model business fields only; identity travels in `S` (`RequestContext`, or `{ tenantId }` for tenant-only rows). Row literals are `satisfies TableEntry<Subject, S>`.

---

## Background facts (verified against code 2026-06-10 — do NOT re-derive)

**Phase-0 (shipped):** `SubjectContext = object` / `RegionContext` / re-based `RequestContext` in `libs/event-processor/src/domain/schemas.ts`; `BusEvent<T, S extends SubjectContext = RequestContext>` (`platform/bus.ts`), `TableEntry<T extends object, S extends SubjectContext = RequestContext>` (`platform/table.ts`); `expectContractMatch` at `apps/e2e-feature-tests/src/helpers/contract-assert.ts`; `poll` at `apps/e2e-feature-tests/src/helpers/poll.ts`.

**The existing zod ROW schemas are UNUSED outside their own `domain/` barrels.** `grep -rn 'BrokerOrderSchema|NormalizedEventSchema|ExecutionModeSchema|AlpacaOrderResultSchema|AlpacaTransferResultSchema|AlpacaAccountSnapshotSchema|CircuitBreakerSchema'` over `services libs apps` returns only the definition files + one stale comment. ⇒ replacing them is near-zero blast radius.

**broker-ctrl Egress (live `service.stack.ts`, NOT the stale CLAUDE.md card):** TWO CDC typenames — `NormalizedEvent` (passthrough on `sk` → `ORDER_FILLED`/`ORDER_PARTIALLY_FILLED`/`ORDER_REJECTED`/`ORDER_CANCELLED`/`ORDER_ESCALATED`) and `FundingEvent` (funding — **OUT OF SCOPE**, already covered via `execution-adpt/domain` `FundingSnapshot`). The card lists stale funding event names (`service-card-funding-event-type-drift`); the closing-phase `audit-service` regen fixes it.

### Census — Execution producer subjects (the work surface)

| Producer | Subject (dry) | Row __typename / sk | Emitted as | Context `S` | Home | Status |
|---|---|---|---|---|---|---|
| broker-ctrl | `NormalizedOrderEvent` | `NormalizedEvent` / `ORDER_*#ts` | ORDER_FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED/ESCALATED | `RequestContext` | broker-ctrl/contracts | **NEW** (replaces row schema) |
| broker-ctrl | `BrokerOrder` | `BrokerOrder` / `BrokerOrder` | — (internal state) | `{ tenantId }` | broker-ctrl/contracts | **NEW** (replaces row schema) |
| broker-ctrl | `ExecutionMode` | `ExecutionMode` / `ExecutionMode` | — (CommandOwned cache) | `{ tenantId }` | broker-ctrl/contracts | **NEW** (replaces row schema) |
| broker-sim-adpt | `VirtualTrade` | `VirtualTrade` / `Trade#${tradeId}` | SIM_ORDER_FILLED / SIM_ORDER_REJECTED | `RequestContext` | broker-sim-adpt/contracts | **NEW** |
| broker-sim-adpt | `SimWithdrawalCompleted` | `WithdrawalCompleted` | SIM_WITHDRAWAL_COMPLETED | `RequestContext` | broker-sim-adpt/contracts | **NEW** |
| broker-sim-adpt | `SimDepositCompleted` | `DepositDetected` | SIM_DEPOSIT_COMPLETED | `RequestContext` | broker-sim-adpt/contracts | EXISTS (keep) |
| broker-sim-adpt | `VirtualCashBalance`/`VirtualPosition`/`VirtualSnapshot` | resp. | — (internal read-model) | `RequestContext` | broker-sim-adpt/contracts | **NEW** |
| broker-alpaca-adpt | `AlpacaOrderResult` | `AlpacaOrderResult` / `OrderMapping`\|`CancelResult` | ALPACA_ORDER_* (6) | `{ tenantId }` | broker-alpaca-adpt/contracts | **NEW** (replaces row schema) |
| broker-alpaca-adpt | `AlpacaTransferResult` | `AlpacaTransferResult` / `TransferMapping` | ALPACA_TRANSFER_INITIATED/COMPLETED/FAILED | `{ tenantId }` | broker-alpaca-adpt/contracts | **NEW** (replaces row schema) |
| broker-alpaca-adpt | `AlpacaAccountSnapshot` | `AlpacaAccountSnapshot` / `Snapshot#ts` | ALPACA_ACCOUNT_SNAPSHOT | `{ tenantId }` | broker-alpaca-adpt/contracts | **NEW** (replaces row schema) |
| broker-alpaca-adpt | `BrokerCircuitEvent` | `NormalizedEvent` / `BROKER_CIRCUIT_OPEN#ts` | BROKER_CIRCUIT_OPEN/CLOSED/ESCALATED | `RequestContext` | broker-alpaca-adpt/contracts | **NEW** |
| broker-alpaca-adpt | `CircuitBreaker` | `CircuitBreaker` / `CircuitBreaker` | — (internal state) | `{ tenantId }`* | broker-alpaca-adpt/contracts | **NEW** (replaces row schema) |
| execution-ctrl | `Order` | `Order` / `Order` | ORDER_CREATED/UPDATED/SUBMITTED/STAGED/REJECTED | `RequestContext` | execution-ctrl/contracts | **NEW** |
| execution-ctrl | `StagedOrder` | `StagedOrder` / `StagedOrder` | STAGED_ORDER_CREATED/UPDATED | `RequestContext` | execution-ctrl/contracts | **NEW** |

\* `CircuitBreaker` state row carries no tenant identity (global per-adapter `CircuitBreaker#alpaca`) — see "real row shapes" below; its `S` is the bare `SubjectContext`.

### Real persisted row shapes (the e2e gate validates THESE — verbatim from code)

- **broker-ctrl `NormalizedEvent` (order)** — `order-state-machine.ts` ASL (lines ~106/205/273). Fields: `pk=NormalizedEvent#${tenantId}#${orderId}`, `sk=ORDER_{FILLED|REJECTED|ESCALATED}#${ts}`, `__typename='NormalizedEvent'`, `tenantId`, `userId`, `region`, `orderId`, `executionMode`, `filledQty`?(FILLED), `averageFillPrice`?(FILLED), `failureReason`?(REJECTED/ESCALATED), `timestamp`. (Written in Step-Functions ASL, not TS — contract-only; the `amount`/`currency` on the old schema were funding-vestigial, never written by the order path.)
- **broker-ctrl `BrokerOrder`** — `repositories/broker-order.repository.ts:22-43`. `pk=BrokerOrder#${tenantId}#${orderId}`, `sk='BrokerOrder'`, `__typename`, `state`, `tenantId`, `orderId`, `executionMode`, `routedTo`, `fillTaskToken`, `requestedQty`, `filledQty`, `remainingQty`, `retryCount`, `instrumentId`, `routedAt`; SF UpdateItem later adds `filledAt`/`averageFillPrice`/`failureReason`. **No `userId`/`region`** → `S = { tenantId }`.
- **broker-ctrl `ExecutionMode`** — `handlers/mode-listener.ts:10-18`, `record('ExecutionMode', { __typename, tenantId, mode, updatedAt }, { pk: 'ExecutionMode#'+tenantId, sk: 'ExecutionMode' })`. **No userId/region** → `S = { tenantId }`.
- **broker-sim `VirtualTrade`** — `repositories/virtual-ledger.repository.ts:261-282`. `pk=VirtualLedger#${tenantId}#${userId}`, `sk=Trade#${tradeId}`, `__typename`, `...ctx`(tenantId,userId,region), `timestamp`, `tradeId`, `orderId`, `symbol`, `side`, `quantity`, `fillPrice`, `totalValue`, `cashBefore`, `cashAfter`, `executedAt`. **No `status` field on the row** (the Egress `status=REJECTED` branch never matches — latent dead mapping, noted, NOT fixed here). `S = RequestContext`.
- **broker-sim `WithdrawalCompleted`** — `handlers/event-listener.ts:106-114`. subject `{ __typename, tenantId, withdrawalId, amount, userId, sourceEventId, timestamp }`. NOTE `amount` (dollars), not `amountCents` — deposit/withdrawal field asymmetry, tracked by `broker-funding-completed-normalization-drift`, OUT of scope.
- **broker-sim `DepositDetected`** — `handlers/event-listener.ts:155-164`. subject `{ __typename, tenantId, depositId, amountCents, currency, userId, sourceEventId, timestamp }`. `SimDepositCompletedSchema` already covers it.
- **broker-sim `VirtualCashBalance`** (`virtual-ledger.repository.ts:60-70`): `+ currency, balance, version, updatedAt`. **`VirtualPosition`** (242-257): `+ symbol, quantity, averageCostBasis, marketValue, updatedAt`. **`VirtualSnapshot`** (318-326): `+ date, cashBalance, positions[], totalValue, createdAt`. All `pk=VirtualLedger#${tenantId}#${userId}` + `...ctx` → `S = RequestContext`.
- **broker-alpaca `AlpacaOrderResult`** — `order-mapping.repository.ts:14-26` + `handlers/event-listener.ts:41-65,104-136`. `pk=OrderMapping#${tenantId}#${nestfolioOrderId}`, `sk='OrderMapping'`|`'CancelResult'`, `__typename`, `tenantId`, `nestfolioOrderId`, `alpacaOrderId`(`''` on broker-unavailable), `status`, `symbol`?, `side`?, `requestedQty`?, `filledQuantity`?, `averageFillPrice`?, `rejectionReason`?, `timestamp`. (`symbol/side/requestedQty` present on PLACED/REJECTED; absent on `CancelResult`.) **No userId/region** → `S = { tenantId }`.
- **broker-alpaca `AlpacaTransferResult`** — `transfer-mapping.repository.ts:14-26` + `event-listener.ts:195-207`. `pk=TransferMapping#${tenantId}#${nestfolioTransferId}`, `sk='TransferMapping'`, `__typename`, `tenantId`, `nestfolioTransferId`, `alpacaTransferId`, `direction`, `amount`, `status`, `failureReason`?, `timestamp`. `S = { tenantId }`.
- **broker-alpaca `AlpacaAccountSnapshot`** — `event-listener.ts:238-264`. `pk=AccountSnapshot#${tenantId}`, `sk=Snapshot#${ts}`, `__typename`, `tenantId`, `equity`(number|null), `buyingPower`(number|null), `positions: [{symbol,qty,marketValue}]`, `status`?='FAILED', `failureReason`?. **No `timestamp` on the subject literal** (it's in `sk`). `S = { tenantId }`.
- **broker-alpaca circuit `NormalizedEvent`** — `circuit-breaker.repository.ts:67-78`. `pk=NormalizedEvent#${tenantId}#CIRCUIT_BREAKER`, `sk=BROKER_CIRCUIT_OPEN#${ts}`, `__typename='NormalizedEvent'`, `...context`(tenantId,userId,region), `timestamp`, `adapter`. `S = RequestContext`.
- **broker-alpaca `CircuitBreaker` state** — `circuit-breaker.repository.ts` (`open()`): `pk=CircuitBreaker#${adapter}`, `sk='CircuitBreaker'`, `__typename`, `state`, `adapter`, `openedAt`, `closedAt`?, `reason`. **No tenant identity** (global per-adapter) → `S = SubjectContext`.
- **execution-ctrl `Order`** — `handlers/event-listener.ts:46-90` (3 `record('Order', …)` calls). subject `{ __typename, tenantId, orderId, decisionPacketId, proposedTrades, status: REJECTED|SUBMITTED|STAGED, reason?(REJECTED), sourceEventId, createdAt, updatedAt, timestamp }`, `pk=Order#${tenantId}#${orderId}`, `sk='Order'`. `S = RequestContext`. (Dead `OrderRepository.createOrder` writes `status:'PENDING'` — never called; live path uses `record()`. ORDER_CREATED default-emit is effectively dead but the contract covers it.)
- **execution-ctrl `StagedOrder`** — `event-listener.ts:91-98`. subject `{ __typename, tenantId, orderId, proposedTrades, stagedAt, timestamp }`, `pk=StagedOrder#${tenantId}#${orderId}`, `sk='StagedOrder'`. `S = RequestContext`. Only written when market is CLOSED.
- **`proposedTrades`** nests advisory-produced `ProposedTrade` (plain interface in `advisory-adpt/domain`). It is converted to zod in the **Advisory slice (4)** — typed loosely (`z.array(z.unknown())`) here; `execution-ctrl` imports the interface **unchanged**.

### e2e validation surface (verified)

- `onboarded()` defaults to **simulation** mode (`accountMode: 'simulation'`). `FreshTenant` exposes `userId`. `EventBridgeClient.putEvent({bus, targetService, detailType, detail})` wraps `detail` as `subject` and auto-injects `context = {tenantId, userId, region}`. Buses: `investor`/`advisory`/`execution`/`ledger`. broker-ctrl/broker-sim/broker-alpaca/execution-ctrl all listen on `execution`.
- **No existing e2e drives the real order pipeline** (withHoldings injects a synthetic `ORDER_FILLED` straight to ledger-ctrl, bypassing execution). The gate must trigger it.
- **broker-ctrl subscribes to `ORDER_SUBMITTED`** (Orchestration trigger → routeOrderFn). Emitting a synthetic `ORDER_SUBMITTED` to broker-ctrl deterministically exercises broker-ctrl→broker-sim/alpaca **without** execution-ctrl's market-hours gate.
- **execution-ctrl market-hours gate:** `DECISION_APPROVED` → safety checks → `Order` row (SUBMITTED if market open, STAGED+StagedOrder if closed). An `Order` row is written **regardless** of market state (REJECTED/SUBMITTED/STAGED) → `OrderSchema` is always validatable. `StagedOrder` only on market-closed → unit-covered + opportunistic e2e (documented boundary).
- **Real Alpaca paper safety (2026-04-10 finding):** the deployed adapter's default `baseUrl` SSM param is `https://paper-api.alpaca.markets`; the AlpacaClient reads it via the Parameters-and-Secrets extension (caches ~300s). `alpacaPaperReset(prefix)` refuses any non-paper-allowlist URL and `DELETE`s open orders/positions. Long-lived order/transfer polling SFs can outlive the test and poll real paper. **Mitigations in Task 5.**

---

## File Structure

**Create:**
- `services/execution/broker-ctrl/src/domain/contracts.ts` — `NormalizedOrderEvent`, `BrokerOrder`, `ExecutionMode`.
- `services/execution/broker-ctrl/test/unit/domain/contracts.test.ts`.
- `services/execution/broker-alpaca-adpt/src/domain/contracts.ts` — `AlpacaOrderResult`, `AlpacaTransferResult`, `AlpacaAccountSnapshot`, `BrokerCircuitEvent`, `CircuitBreaker`.
- `services/execution/broker-alpaca-adpt/test/unit/domain/contracts.test.ts`.
- `services/execution/execution-ctrl/src/domain/contracts.ts` — `Order`, `StagedOrder`.
- `services/execution/execution-ctrl/test/unit/domain/contracts.test.ts`.
- `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` — the #1-risk gate (SIM + REAL Alpaca paper).

**Modify:**
- `services/execution/broker-ctrl/src/domain/schemas.ts` — DELETE (move dry subjects to `contracts.ts`). Update `domain/index.ts` barrel.
- `services/execution/broker-ctrl/src/repositories/broker-order.repository.ts` — type the literal `satisfies TableEntry<BrokerOrder, { tenantId: string }>`.
- `services/execution/broker-ctrl/src/handlers/mode-listener.ts` — type the `record()` payload against `ExecutionMode`.
- `services/execution/broker-sim-adpt/src/domain/contracts.ts` — extend (add `VirtualTrade`, `SimWithdrawalCompleted`, `VirtualCashBalance`, `VirtualPosition`, `VirtualSnapshot`).
- `services/execution/broker-sim-adpt/test/unit/domain/contracts.test.ts` (or `test/unit/contracts.test.ts` — match existing layout) — add tests.
- `services/execution/broker-sim-adpt/src/repositories/virtual-ledger.repository.ts` — type the 4 literals `satisfies TableEntry<Subject>`.
- `services/execution/broker-sim-adpt/src/handlers/event-listener.ts` — type the `WithdrawalCompleted` record() payload against `SimWithdrawalCompleted` (DepositDetected already covered).
- `services/execution/broker-alpaca-adpt/src/domain/schemas.ts` — keep the Alpaca REST `*ApiResponse` interfaces; DELETE the row schemas (moved to `contracts.ts`). Update `domain/index.ts` barrel.
- `services/execution/broker-alpaca-adpt/src/repositories/{order-mapping,transfer-mapping,circuit-breaker}.repository.ts` + `src/handlers/event-listener.ts` — type the write-literals `satisfies TableEntry<Subject, S>`.
- `services/execution/execution-ctrl/src/handlers/event-listener.ts` — type the 3 `Order` + 1 `StagedOrder` record() payloads.
- `tsconfig.base.json` — add `@nestfolio/broker-ctrl/contracts`, `@nestfolio/broker-alpaca-adpt/contracts`, `@nestfolio/execution-ctrl/contracts` (`broker-sim-adpt/contracts` already exists).
- 4 service `CLAUDE.md` cards (Task 6, via `audit-service`).

---

### Task 1: broker-ctrl — `NormalizedOrderEvent` / `BrokerOrder` / `ExecutionMode` contracts

**Files:**
- Create: `services/execution/broker-ctrl/src/domain/contracts.ts`
- Delete: `services/execution/broker-ctrl/src/domain/schemas.ts`
- Modify: `services/execution/broker-ctrl/src/domain/index.ts`
- Test: `services/execution/broker-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/execution/broker-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import {
  NormalizedOrderEventSchema,
  BrokerOrderSchema,
  ExecutionModeSchema,
} from '../../../src/domain/contracts';

describe('broker-ctrl contracts', () => {
  it('NormalizedOrderEventSchema parses a FILLED order subject (dry — identity stripped)', () => {
    const row = {
      pk: 'NormalizedEvent#t#o1', sk: 'ORDER_FILLED#2026', __typename: 'NormalizedEvent',
      tenantId: 't', userId: 'u', region: 'us-east-1',
      orderId: 'o1', executionMode: 'simulation', filledQty: 10, averageFillPrice: 200,
      timestamp: '2026-06-10T00:00:00.000Z',
    };
    const parsed = NormalizedOrderEventSchema.parse(row);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.orderId).toBe('o1');
    expect(parsed.filledQty).toBe(10);
  });

  it('NormalizedOrderEventSchema parses a REJECTED order subject (failureReason, no fill)', () => {
    expect(NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'live', failureReason: 'insufficient buying power',
      timestamp: '2026-06-10T00:00:00.000Z',
    }).failureReason).toBe('insufficient buying power');
  });

  it('NormalizedOrderEventSchema rejects an unknown executionMode', () => {
    expect(() => NormalizedOrderEventSchema.parse({
      orderId: 'o1', executionMode: 'paper', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('BrokerOrderSchema parses the internal state row (dry)', () => {
    const parsed = BrokerOrderSchema.parse({
      tenantId: 't', pk: 'BrokerOrder#t#o1', sk: 'BrokerOrder', __typename: 'BrokerOrder',
      orderId: 'o1', executionMode: 'live', state: 'AWAITING_FILL', routedTo: 'alpaca',
      requestedQty: 10, filledQty: 0, remainingQty: 10, retryCount: 0,
      instrumentId: 'VTI', routedAt: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.state).toBe('AWAITING_FILL');
  });

  it('ExecutionModeSchema parses the cache row (dry)', () => {
    expect(ExecutionModeSchema.parse({ mode: 'live', updatedAt: '2026-06-10T00:00:00.000Z' }).mode).toBe('live');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run broker-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module `../../../src/domain/contracts` does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`** (imports ONLY zod):

```typescript
// Producer-owned event/row subject contracts for broker-ctrl. Imports ONLY zod.
// Dry aggregates — identity (tenantId/userId/region) travels in the event context, not here.
import { z } from 'zod';

/**
 * ORDER lifecycle subject — the `NormalizedEvent` row (sk=`ORDER_*#${ts}`) written by the
 * order state machine and CDC-emitted as ORDER_FILLED / ORDER_PARTIALLY_FILLED /
 * ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED. Named for the event (the funding
 * carrier is a separate `FundingEvent` typename). `amount`/`currency` on the old row schema
 * were funding-vestigial — the order path never writes them.
 */
export const NormalizedOrderEventSchema = z.object({
  orderId: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  filledQty: z.number().optional(),
  averageFillPrice: z.number().optional(),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type NormalizedOrderEvent = z.infer<typeof NormalizedOrderEventSchema>;

/**
 * BrokerOrder state row (sk='BrokerOrder') — internal mutable order-routing state, NOT
 * CDC-emitted. Tenant-scoped only (the row carries no userId/region).
 */
export const BrokerOrderSchema = z.object({
  orderId: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  state: z.enum(['ROUTING', 'AWAITING_FILL', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'ESCALATED']),
  routedTo: z.enum(['sim', 'alpaca']),
  fillTaskToken: z.string().optional(),
  requestedQty: z.number(),
  filledQty: z.number(),
  remainingQty: z.number(),
  averageFillPrice: z.number().optional(),
  retryCount: z.number(),
  instrumentId: z.string(),
  routedAt: z.string(),
  filledAt: z.string().optional(),
  failureReason: z.string().optional(),
});
export type BrokerOrder = z.infer<typeof BrokerOrderSchema>;

/** ExecutionMode cache row (sk='ExecutionMode') — single per-tenant operating mode
 * (CommandOwned). NOT CDC-emitted. Tenant-scoped only. */
export const ExecutionModeSchema = z.object({
  mode: z.enum(['simulation', 'live']),
  updatedAt: z.string(),
});
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
```

- [ ] **Step 4: Delete `domain/schemas.ts` and rewire `domain/index.ts`**

Delete `services/execution/broker-ctrl/src/domain/schemas.ts` (its 3 zod row schemas are superseded; grep confirmed no external importers). Replace `services/execution/broker-ctrl/src/domain/index.ts` with:

```typescript
export { BrokerCtrlEventTypes, BrokerCtrlRoutedEventTypes, BrokerCtrlInboundEventTypes } from './events';
export { NormalizedOrderEventSchema, BrokerOrderSchema, ExecutionModeSchema } from './contracts';
export type { NormalizedOrderEvent, BrokerOrder, ExecutionMode } from './contracts';
```

- [ ] **Step 5: Add the tsconfig path** — in `tsconfig.base.json` `compilerOptions.paths`, next to `@nestfolio/broker-ctrl/domain`:

```json
      "@nestfolio/broker-ctrl/contracts": ["services/execution/broker-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 6: Type the TS write-literals**

In `services/execution/broker-ctrl/src/repositories/broker-order.repository.ts`, import `type { TableEntry } from '@nestfolio/event-processor'` and `type { BrokerOrder } from '../domain/contracts'`, and annotate the put literal:

```typescript
      const item = {
        pk: `BrokerOrder#${params.tenantId}#${params.orderId}`,
        sk: 'BrokerOrder' as const,
        __typename: 'BrokerOrder' as const,
        createdAt: now,
        // ...existing fields (state, tenantId, orderId, executionMode, routedTo,
        //    fillTaskToken, requestedQty, filledQty, remainingQty, retryCount,
        //    instrumentId, routedAt)...
      } satisfies TableEntry<BrokerOrder, { tenantId: string }> & { __typename: 'BrokerOrder' };
```

> If the put helper does not currently stamp `createdAt`, add `createdAt: now` (required by `TableEntry`; internal-row-only, additive — no wire change). If TypeScript flags excess/missing properties that would require a runtime change, REVERT the `satisfies` to a plain literal and rely on the contract + e2e gate (mirrors the investor slice's non-load-bearing-typing rule). Do NOT change emitted field values.

In `services/execution/broker-ctrl/src/handlers/mode-listener.ts`, type the `record('ExecutionMode', …)` payload subject against `ExecutionMode` (import the type; annotate a `const subject: ExecutionMode = { mode, updatedAt: ctx.timestamp }` and spread `{ __typename: 'ExecutionMode', tenantId: ctx.tenantId, ...subject }`).

- [ ] **Step 7: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p broker-ctrl --testPathPatterns contracts`
Expected: PASS. (`broker-ctrl:typecheck` compiles the read-model-ownership type-test; the `ExecutionMode` row stays `CommandOwned` — unchanged.)

- [ ] **Step 8: Commit**

```bash
git add services/execution/broker-ctrl/src/domain services/execution/broker-ctrl/src/repositories/broker-order.repository.ts services/execution/broker-ctrl/src/handlers/mode-listener.ts services/execution/broker-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(broker-ctrl): NormalizedOrderEvent/BrokerOrder/ExecutionMode contracts; drop row schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

(Worktree commits use `--no-verify` — the pre-commit hook can't run nx-affected in a worktree. See [[feedback-worktree-commit-no-verify]]. Verify each commit landed.)

---

### Task 2: broker-sim-adpt — `VirtualTrade` / `SimWithdrawalCompleted` + internal virtual-ledger contracts

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/domain/contracts.ts`
- Modify: `services/execution/broker-sim-adpt/src/repositories/virtual-ledger.repository.ts`
- Modify: `services/execution/broker-sim-adpt/src/handlers/event-listener.ts`
- Test: `services/execution/broker-sim-adpt/test/unit/contracts.test.ts` (match the existing flat `test/unit/` layout)

- [ ] **Step 1: Write the failing test** — create `services/execution/broker-sim-adpt/test/unit/contracts.test.ts`:

```typescript
import {
  SimDepositCompletedSchema,
  SimWithdrawalCompletedSchema,
  VirtualTradeSchema,
  VirtualCashBalanceSchema,
  VirtualPositionSchema,
  VirtualSnapshotSchema,
} from '../../src/domain/contracts';

describe('broker-sim-adpt contracts', () => {
  it('SimDepositCompletedSchema still parses (regression)', () => {
    expect(SimDepositCompletedSchema.parse({
      depositId: 'd1', amountCents: 1000, currency: 'USD',
      sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    }).depositId).toBe('d1');
  });

  it('SimWithdrawalCompletedSchema parses the WithdrawalCompleted subject (dry)', () => {
    const parsed = SimWithdrawalCompletedSchema.parse({
      tenantId: 't', userId: 'u', withdrawalId: 'w1', amount: 250,
      sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.amount).toBe(250);
  });

  it('VirtualTradeSchema parses a SIM_ORDER_FILLED trade subject (dry)', () => {
    const parsed = VirtualTradeSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1', pk: 'VirtualLedger#t#u', sk: 'Trade#x',
      tradeId: 'x', orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 5,
      fillPrice: 200, totalValue: 1000, cashBefore: 5000, cashAfter: 4000,
      executedAt: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.symbol).toBe('VTI');
  });

  it('VirtualTradeSchema rejects an invalid side', () => {
    expect(() => VirtualTradeSchema.parse({
      tradeId: 'x', orderId: 'o1', symbol: 'VTI', side: 'HOLD', quantity: 5,
      fillPrice: 200, totalValue: 1000, cashBefore: 5000, cashAfter: 4000,
      executedAt: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('internal virtual-ledger rows parse (dry)', () => {
    expect(VirtualCashBalanceSchema.parse({ currency: 'USD', balance: 1000, version: 1, updatedAt: '2026' }).balance).toBe(1000);
    expect(VirtualPositionSchema.parse({ symbol: 'VTI', quantity: 5, averageCostBasis: 200, marketValue: 1000, updatedAt: '2026' }).symbol).toBe('VTI');
    expect(VirtualSnapshotSchema.parse({ date: '2026-06-10', cashBalance: 1000, positions: [], totalValue: 2000, createdAt: '2026' }).totalValue).toBe(2000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run broker-sim-adpt:test --testPathPatterns contracts`
Expected: FAIL — the new schemas are not exported.

- [ ] **Step 3: Extend `domain/contracts.ts`** — append (keep the existing `SimDepositCompletedSchema`):

```typescript
/**
 * SIM_WITHDRAWAL_COMPLETED subject — the `WithdrawalCompleted` row written by
 * event-listener on SIM_WITHDRAWAL_REQUESTED. NOTE: carries `amount` (dollars),
 * NOT amountCents (deposit/withdrawal asymmetry — tracked by
 * broker-funding-completed-normalization-drift, out of scope here). Dry — identity
 * travels in the event context.
 */
export const SimWithdrawalCompletedSchema = z.object({
  withdrawalId: z.string(),
  amount: z.number(),
  sourceEventId: z.string(),
  timestamp: z.string(),
});
export type SimWithdrawalCompleted = z.infer<typeof SimWithdrawalCompletedSchema>;

/** SIM_ORDER_FILLED / SIM_ORDER_REJECTED subject — the `VirtualTrade` row written by the
 * simulation engine. (The row carries no `status`; the Egress status=REJECTED branch is
 * a latent dead mapping — out of scope.) Dry — identity travels in the event context. */
export const VirtualTradeSchema = z.object({
  tradeId: z.string(),
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number(),
  fillPrice: z.number(),
  totalValue: z.number(),
  cashBefore: z.number(),
  cashAfter: z.number(),
  executedAt: z.string(),
});
export type VirtualTrade = z.infer<typeof VirtualTradeSchema>;

/** Internal (NOT CDC-emitted) virtual-ledger read-model rows. Tenant+user-scoped. */
export const VirtualCashBalanceSchema = z.object({
  currency: z.string(),
  balance: z.number(),
  version: z.number(),
  updatedAt: z.string(),
});
export type VirtualCashBalance = z.infer<typeof VirtualCashBalanceSchema>;

export const VirtualPositionSchema = z.object({
  symbol: z.string(),
  quantity: z.number(),
  averageCostBasis: z.number(),
  marketValue: z.number(),
  updatedAt: z.string(),
});
export type VirtualPosition = z.infer<typeof VirtualPositionSchema>;

export const VirtualSnapshotSchema = z.object({
  date: z.string(),
  cashBalance: z.number(),
  positions: z.array(z.unknown()),
  totalValue: z.number(),
  createdAt: z.string(),
});
export type VirtualSnapshot = z.infer<typeof VirtualSnapshotSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run broker-sim-adpt:test --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 5: Type the write-literals** (behavior-preserving)

In `services/execution/broker-sim-adpt/src/repositories/virtual-ledger.repository.ts`, import `type { TableEntry, RequestContext } from '@nestfolio/event-processor'` and the 4 subject types from `../domain/contracts`, and annotate each `TableEntry` literal as `satisfies TableEntry<VirtualTrade, RequestContext> & { __typename: 'VirtualTrade' }` (and likewise for `VirtualCashBalance`/`VirtualPosition`/`VirtualSnapshot`). The literals already spread `...ctx` (RequestContext) + `createdAt`/`updatedAt` where required; if a literal lacks `createdAt`, add it (additive, internal-row-only). **Skip any annotation that won't compile cleanly** — revert to plain literal (non-load-bearing; the e2e gate is the proof).

In `services/execution/broker-sim-adpt/src/handlers/event-listener.ts`, type the `WithdrawalCompleted` `record()` payload: `const subject: SimWithdrawalCompleted = { withdrawalId, amount, sourceEventId: ctx.eventId, timestamp: getTime() };` then `record('WithdrawalCompleted', { __typename: 'WithdrawalCompleted', tenantId, userId, ...subject }, …)`.

- [ ] **Step 6: Run lint + typecheck + the touched unit suites**

Run: `pnpm nx run-many -t test,lint,typecheck -p broker-sim-adpt --testPathPatterns "contracts|virtual-ledger|event-listener"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/execution/broker-sim-adpt/src/domain/contracts.ts services/execution/broker-sim-adpt/src/repositories/virtual-ledger.repository.ts services/execution/broker-sim-adpt/src/handlers/event-listener.ts services/execution/broker-sim-adpt/test/unit/contracts.test.ts
git commit --no-verify -m "feat(broker-sim-adpt): VirtualTrade/SimWithdrawalCompleted + virtual-ledger row contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 3: broker-alpaca-adpt — Alpaca order/transfer/account-snapshot + circuit contracts

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/domain/contracts.ts`
- Modify: `services/execution/broker-alpaca-adpt/src/domain/schemas.ts` (keep `*ApiResponse` interfaces; remove row schemas)
- Modify: `services/execution/broker-alpaca-adpt/src/domain/index.ts`
- Modify: `services/execution/broker-alpaca-adpt/src/repositories/{order-mapping,transfer-mapping,circuit-breaker}.repository.ts`, `src/handlers/event-listener.ts`
- Modify: `tsconfig.base.json`
- Test: `services/execution/broker-alpaca-adpt/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/execution/broker-alpaca-adpt/test/unit/domain/contracts.test.ts`:

```typescript
import {
  AlpacaOrderResultSchema,
  AlpacaTransferResultSchema,
  AlpacaAccountSnapshotSchema,
  BrokerCircuitEventSchema,
  CircuitBreakerSchema,
} from '../../../src/domain/contracts';

describe('broker-alpaca-adpt contracts', () => {
  it('AlpacaOrderResultSchema parses a PLACED order subject (dry)', () => {
    const parsed = AlpacaOrderResultSchema.parse({
      pk: 'OrderMapping#t#o1', sk: 'OrderMapping', __typename: 'AlpacaOrderResult', tenantId: 't',
      nestfolioOrderId: 'o1', alpacaOrderId: 'a1', status: 'PLACED',
      symbol: 'VTI', side: 'buy', requestedQty: 10, timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('PLACED');
  });

  it('AlpacaOrderResultSchema parses a minimal CANCEL_FAILED subject (no symbol/side/qty)', () => {
    expect(AlpacaOrderResultSchema.parse({
      nestfolioOrderId: 'o1', alpacaOrderId: '', status: 'CANCEL_FAILED',
      rejectionReason: 'BROKER_UNAVAILABLE', timestamp: '2026-06-10T00:00:00.000Z',
    }).status).toBe('CANCEL_FAILED');
  });

  it('AlpacaTransferResultSchema parses an INITIATED transfer subject (dry)', () => {
    expect(AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'tr1', alpacaTransferId: 'at1', direction: 'INCOMING',
      amount: 500, status: 'INITIATED', timestamp: '2026-06-10T00:00:00.000Z',
    }).direction).toBe('INCOMING');
  });

  it('AlpacaAccountSnapshotSchema parses success + failure shapes', () => {
    expect(AlpacaAccountSnapshotSchema.parse({
      equity: 10000, buyingPower: 5000, positions: [{ symbol: 'VTI', qty: 5, marketValue: 1000 }],
    }).equity).toBe(10000);
    const failed = AlpacaAccountSnapshotSchema.parse({
      equity: null, buyingPower: null, positions: [], status: 'FAILED', failureReason: 'timeout',
    });
    expect(failed.status).toBe('FAILED');
  });

  it('BrokerCircuitEventSchema parses the circuit event subject (dry)', () => {
    const parsed = BrokerCircuitEventSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1', adapter: 'alpaca', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.adapter).toBe('alpaca');
  });

  it('CircuitBreakerSchema parses the state row (dry)', () => {
    expect(CircuitBreakerSchema.parse({
      state: 'OPEN', adapter: 'alpaca', openedAt: '2026', reason: 'health check down',
    }).state).toBe('OPEN');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run broker-alpaca-adpt:test --testPathPatterns contracts`
Expected: FAIL — module `../../../src/domain/contracts` does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`** (imports ONLY zod):

```typescript
// Producer-owned event/row subject contracts for broker-alpaca-adpt. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';

/** ALPACA_ORDER_* subject — the `AlpacaOrderResult` row (sk='OrderMapping'|'CancelResult').
 * symbol/side/requestedQty are present on PLACED/REJECTED, absent on CancelResult. Tenant-scoped. */
export const AlpacaOrderResultSchema = z.object({
  nestfolioOrderId: z.string(),
  alpacaOrderId: z.string(),
  status: z.enum(['PLACED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'CANCEL_FAILED']),
  symbol: z.string().optional(),
  side: z.string().optional(),
  requestedQty: z.number().optional(),
  filledQuantity: z.number().optional(),
  averageFillPrice: z.number().optional(),
  rejectionReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaOrderResult = z.infer<typeof AlpacaOrderResultSchema>;

/** ALPACA_TRANSFER_* subject — the `AlpacaTransferResult` row (sk='TransferMapping'). */
export const AlpacaTransferResultSchema = z.object({
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;

/** ALPACA_ACCOUNT_SNAPSHOT subject — the `AlpacaAccountSnapshot` row (sk='Snapshot#${ts}').
 * equity/buyingPower are null on the failure path. No `timestamp` on the subject (it is in sk). */
export const AlpacaAccountSnapshotSchema = z.object({
  equity: z.number().nullable(),
  buyingPower: z.number().nullable(),
  positions: z.array(z.object({
    symbol: z.string(),
    qty: z.number(),
    marketValue: z.number(),
  })),
  status: z.string().optional(),
  failureReason: z.string().optional(),
});
export type AlpacaAccountSnapshot = z.infer<typeof AlpacaAccountSnapshotSchema>;

/** BROKER_CIRCUIT_OPEN/CLOSED/ESCALATED subject — the circuit-breaker `NormalizedEvent` row
 * (sk='BROKER_CIRCUIT_OPEN#${ts}', pk=`NormalizedEvent#${tenantId}#CIRCUIT_BREAKER`). */
export const BrokerCircuitEventSchema = z.object({
  adapter: z.string(),
  timestamp: z.string(),
});
export type BrokerCircuitEvent = z.infer<typeof BrokerCircuitEventSchema>;

/** CircuitBreaker state row (sk='CircuitBreaker', pk='CircuitBreaker#${adapter}') — global
 * per-adapter, NOT CDC-emitted, NO tenant identity. */
export const CircuitBreakerSchema = z.object({
  state: z.enum(['OPEN', 'CLOSED']),
  adapter: z.string(),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  reason: z.string(),
});
export type CircuitBreaker = z.infer<typeof CircuitBreakerSchema>;
```

- [ ] **Step 4: Trim `domain/schemas.ts` + rewire the barrel**

In `services/execution/broker-alpaca-adpt/src/domain/schemas.ts`, KEEP the Alpaca REST `*ApiResponse` interfaces (`AlpacaOrderApiResponse`, `AlpacaAccountApiResponse`, `AlpacaPositionApiResponse`, `AlpacaTransferApiResponse`, `AlpacaTradeEvent`) — they describe the external API, not producer rows. DELETE the 4 row zod schemas (`AlpacaOrderResultSchema`/`AlpacaTransferResultSchema`/`CircuitBreakerSchema`/`AlpacaAccountSnapshotSchema`) + their inferred types (now in `contracts.ts`).

Replace `services/execution/broker-alpaca-adpt/src/domain/index.ts`:

```typescript
export * from './events';
export * from './schemas';     // now only the *ApiResponse interfaces
export {
  AlpacaOrderResultSchema, AlpacaTransferResultSchema, AlpacaAccountSnapshotSchema,
  BrokerCircuitEventSchema, CircuitBreakerSchema,
} from './contracts';
export type {
  AlpacaOrderResult, AlpacaTransferResult, AlpacaAccountSnapshot,
  BrokerCircuitEvent, CircuitBreaker,
} from './contracts';
```

> The `AlpacaOrderResult`/etc. **type names** are unchanged from the old schemas, so any intra-service importer of the type keeps compiling; only the SHAPE changed (now dry). Verify with `grep -rn "AlpacaOrderResult\b" services/execution/broker-alpaca-adpt/src` — every site that built a full row literal is retyped in Step 5.

- [ ] **Step 5: Add the tsconfig path + type the write-literals**

In `tsconfig.base.json`, add next to `@nestfolio/broker-alpaca-adpt/domain`:

```json
      "@nestfolio/broker-alpaca-adpt/contracts": ["services/execution/broker-alpaca-adpt/src/domain/contracts.ts"],
```

Type the row literals `satisfies TableEntry<Subject, S>` (import `TableEntry`/`RequestContext` from `@nestfolio/event-processor`, subjects from `../domain/contracts`):
- `order-mapping.repository.ts` + `event-listener.ts` AlpacaOrderResult literals → `satisfies TableEntry<AlpacaOrderResult, { tenantId: string }> & { __typename: 'AlpacaOrderResult' }` (add `createdAt` if absent).
- `transfer-mapping.repository.ts` + `event-listener.ts` → `AlpacaTransferResult`.
- `event-listener.ts` account-snapshot literals → `AlpacaAccountSnapshot`.
- `circuit-breaker.repository.ts` `open()` literal → `CircuitBreaker` (`S = Record<string, never>` / bare base — no tenant identity); `writeBreakerOpenEvent()` literal → `satisfies TableEntry<BrokerCircuitEvent, RequestContext> & { __typename: 'NormalizedEvent' }`.

**Skip any `satisfies` that won't compile cleanly** (revert to plain literal). Do NOT change emitted field values.

- [ ] **Step 6: Run the test + lint + the touched unit suites**

Run: `pnpm nx run-many -t test,lint -p broker-alpaca-adpt --testPathPatterns "contracts|order-mapping|transfer-mapping|circuit-breaker|event-listener"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/execution/broker-alpaca-adpt/src/domain services/execution/broker-alpaca-adpt/src/repositories services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts services/execution/broker-alpaca-adpt/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(broker-alpaca-adpt): order/transfer/account-snapshot/circuit contracts; drop row schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 4: execution-ctrl — `Order` / `StagedOrder` contracts

**Files:**
- Create: `services/execution/execution-ctrl/src/domain/contracts.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `tsconfig.base.json`
- Test: `services/execution/execution-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/execution/execution-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import { OrderSchema, StagedOrderSchema } from '../../../src/domain/contracts';

describe('execution-ctrl contracts', () => {
  it('OrderSchema parses a SUBMITTED order subject (dry — identity stripped)', () => {
    const parsed = OrderSchema.parse({
      __typename: 'Order', tenantId: 't', pk: 'Order#t#o1', sk: 'Order',
      orderId: 'o1', decisionPacketId: 'dp1',
      proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500000 }],
      status: 'SUBMITTED', sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('SUBMITTED');
    expect(parsed.proposedTrades.length).toBe(1);
  });

  it('OrderSchema parses a REJECTED order subject (reason present)', () => {
    expect(OrderSchema.parse({
      orderId: 'o1', decisionPacketId: 'dp1', proposedTrades: [],
      status: 'REJECTED', reason: 'safety check failed', timestamp: '2026-06-10T00:00:00.000Z',
    }).reason).toBe('safety check failed');
  });

  it('OrderSchema rejects an unknown status', () => {
    expect(() => OrderSchema.parse({
      orderId: 'o1', decisionPacketId: 'dp1', proposedTrades: [], status: 'DONE',
      timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('StagedOrderSchema parses a staged order subject (dry)', () => {
    expect(StagedOrderSchema.parse({
      orderId: 'o1', proposedTrades: [], stagedAt: '2026-06-10T00:00:00.000Z',
      timestamp: '2026-06-10T00:00:00.000Z',
    }).orderId).toBe('o1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run execution-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module `../../../src/domain/contracts` does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`** (imports ONLY zod):

```typescript
// Producer-owned event/row subject contracts for execution-ctrl. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';

/**
 * Order subject — the `Order` row (sk='Order') written by event-listener on
 * DECISION_APPROVED / USER_CONFIRMED, CDC-emitted as ORDER_CREATED (default insert) /
 * ORDER_SUBMITTED / ORDER_STAGED / ORDER_REJECTED / ORDER_UPDATED (modify default).
 * The live path writes SUBMITTED/STAGED/REJECTED; 'PENDING' is the dead createOrder value.
 *
 * `proposedTrades` nests advisory-produced ProposedTrade[] (advisory-adpt/domain). It is
 * converted to zod in the Advisory slice (4); typed loosely here. execution-ctrl imports
 * the ProposedTrade interface UNCHANGED.
 */
export const OrderSchema = z.object({
  orderId: z.string(),
  decisionPacketId: z.string(),
  proposedTrades: z.array(z.unknown()),
  status: z.enum(['SUBMITTED', 'STAGED', 'REJECTED', 'PENDING']),
  reason: z.string().optional(),
  sourceEventId: z.string().optional(),
  timestamp: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/** StagedOrder subject — the `StagedOrder` row (sk='StagedOrder') written when the market is
 * closed, CDC-emitted as STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED. */
export const StagedOrderSchema = z.object({
  orderId: z.string(),
  proposedTrades: z.array(z.unknown()),
  stagedAt: z.string(),
  timestamp: z.string(),
});
export type StagedOrder = z.infer<typeof StagedOrderSchema>;
```

- [ ] **Step 4: Add the tsconfig path** — in `tsconfig.base.json`, next to `@nestfolio/execution-ctrl/events`:

```json
      "@nestfolio/execution-ctrl/contracts": ["services/execution/execution-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 5: Type the `record()` payloads in `event-listener.ts`** (behavior-preserving)

Import `import type { Order, StagedOrder } from '../domain/contracts';`. For each of the 3 `record('Order', { … })` calls, extract a typed `const subject: Order = { orderId, decisionPacketId, proposedTrades, status: 'SUBMITTED'|'STAGED'|'REJECTED', ...(reason ? { reason } : {}), sourceEventId: ctx.eventId, timestamp: now };` and pass `record('Order', { __typename: 'Order', tenantId, ...subject, createdAt: now, updatedAt: now }, { pk, sk: 'Order' })`. For the `StagedOrder` call, `const staged: StagedOrder = { orderId, proposedTrades, stagedAt: now, timestamp: now };`.

> `proposedTrades` stays typed `ProposedTrade[]` (from advisory-adpt/domain) at the call-site; it assigns to the contract's `z.array(z.unknown())` field cleanly. Do NOT change emitted values.

- [ ] **Step 6: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p execution-ctrl --testPathPatterns "contracts|event-listener"`
Expected: PASS. (`execution-ctrl:typecheck` compiles the read-model-ownership type-test; `Order`/`StagedOrder` stay `CommandOwned` — unchanged.)

- [ ] **Step 7: Commit**

```bash
git add services/execution/execution-ctrl/src/domain/contracts.ts services/execution/execution-ctrl/src/handlers/event-listener.ts services/execution/execution-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(execution-ctrl): Order + StagedOrder producer contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 5: e2e validation gate — THE #1 RISK (SIM path + REAL Alpaca paper)

**Files:**
- Create: `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`

Mirror `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts`. Two `it` blocks:

**(A) SIM path (deterministic, cheap):**
- Emit a synthetic `DECISION_APPROVED` to `execution-ctrl` (bus `execution`) with `proposedTrades` → execution-ctrl writes an `Order` row (SUBMITTED/STAGED/REJECTED — all parse `OrderSchema`). Validate `Order`.
- Emit a synthetic `ORDER_SUBMITTED` directly to `broker-ctrl` (bypasses the market-hours gate) → broker-ctrl routes to broker-**sim** (onboarded() default) → `BrokerOrder` row + (on sim fill) callback → `NormalizedEvent` order row + broker-sim `VirtualTrade` row. Validate `NormalizedOrderEventSchema` (broker-ctrl table) + `VirtualTradeSchema` (broker-sim table).
- The funding path (`onboarded()` + a deposit + withdrawal) → broker-sim `DepositDetected` (`SimDepositCompletedSchema`) + `WithdrawalCompleted` (`SimWithdrawalCompletedSchema`). (Reuse the `initiateDeposit`/`requestWithdrawal` mutations from the funding scenarios, OR emit `SIM_DEPOSIT_INITIATED`/`SIM_WITHDRAWAL_REQUESTED` directly to broker-sim.)
- `StagedOrder`: covered by the Task-4 unit test (deterministic) + opportunistically here when the run lands during US market-closed hours. Documented boundary in-file ([[no-silent-caps]]).

**(B) REAL Alpaca paper path (high-fidelity, gated):**
- `alpacaPaperReset(ctx.prefix)` in `beforeAll` AND `afterAll` (the paper-allowlist guard refuses non-paper URLs).
- Switch the tenant to **live** mode: emit `EXECUTION_MODE_CHANGED` (`mode: 'live'`) to `broker-ctrl` (bus `execution`) → broker-ctrl caches `ExecutionMode` row. **Flush the Parameters-and-Secrets SSM cache risk:** wait ≥1 poll cycle / re-emit so the ExecutionMode row is materialized before submitting (poll the `ExecutionMode#${tenantId}` row before proceeding).
- Drive a REAL Alpaca paper order: emit `ORDER_SUBMITTED` to broker-ctrl (now live) → routeOrder → `ALPACA_ORDER_REQUESTED` → broker-alpaca → real paper order → `AlpacaOrderResult` row. Validate `AlpacaOrderResultSchema`. Poll the real Alpaca paper order to FILLED via the OrderPollingStateMachine → re-validate the modify row.
- Drive a REAL Alpaca paper transfer: emit `DEPOSIT_INITIATED` to broker-ctrl (live) → `ALPACA_TRANSFER_REQUESTED` → broker-alpaca → `AlpacaTransferResult` row. Validate `AlpacaTransferResultSchema`.
- Drive an account check: emit `ALPACA_ACCOUNT_CHECK` to broker-alpaca → `AlpacaAccountSnapshot` row. Validate `AlpacaAccountSnapshotSchema`.
- **Orphaned-poll-SF cleanup (2026-04-10 finding):** in `afterAll`, after `alpacaPaperReset`, stop any running broker-alpaca order/transfer polling Step Function executions for this tenant so they don't poll real paper after the test (list executions on the deployed SF ARNs via SSM, `StopExecution` the ones whose input carries this tenant). Document this in-file as the real-paper-leak mitigation.
- `BrokerCircuitEvent` / `CircuitBreaker`: validated by the Task-3 unit test; the existing `circuit-breaker-lifecycle.e2e.test.ts` already exercises the real circuit path (don't duplicate). Documented boundary.

- [ ] **Step 1: Write the gate file** — create `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`. Structure (mirror the ledger gate's imports + poll/expectContractMatch usage):

```typescript
/**
 * Validation-gate e2e — execution-domain producer contracts vs REAL emission.
 *
 * (A) SIM path — synthetic DECISION_APPROVED / ORDER_SUBMITTED triggers + funding mutations
 *     drive REAL execution-ctrl + broker-ctrl + broker-sim producer rows.
 * (B) REAL Alpaca paper path — tenant switched to live mode drives REAL Alpaca paper
 *     order/transfer/account-snapshot rows. SAFETY: alpacaPaperReset (paper-allowlist
 *     guard) before+after; orphaned poll-SF cleanup in afterAll (2026-04-10 real-paper-leak).
 *
 * Coverage: Order, NormalizedOrderEvent, VirtualTrade, SimDepositCompleted,
 *   SimWithdrawalCompleted, AlpacaOrderResult, AlpacaTransferResult, AlpacaAccountSnapshot.
 * Boundary (unit-only / documented): StagedOrder (market-closed), BrokerCircuitEvent +
 *   CircuitBreaker (covered by circuit-breaker-lifecycle.e2e), internal virtual-ledger rows.
 *
 * Key keys: broker-ctrl Order? no — execution-ctrl Order pk=Order#${tenantId}#${orderId} sk='Order';
 *   broker-ctrl NormalizedEvent pk=NormalizedEvent#${tenantId}#${orderId} sk=ORDER_*#${ts};
 *   broker-sim VirtualTrade pk=VirtualLedger#${tenantId}#${userId} sk=Trade#${tradeId};
 *   broker-alpaca AlpacaOrderResult pk=OrderMapping#${tenantId}#${orderId} sk='OrderMapping'.
 * tenantId-index GSI: PK=tenantId, SK=__typename, ProjectionType=ALL.
 *
 * DO NOT run directly outside the closing phase. Execution is gated by the closing task.
 */
import { createTestContext, EventBridgeClient, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, funded, poll, alpacaPaperReset, type FreshTenant } from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { OrderSchema } from '@nestfolio/execution-ctrl/contracts';
import { NormalizedOrderEventSchema } from '@nestfolio/broker-ctrl/contracts';
import { VirtualTradeSchema, SimDepositCompletedSchema, SimWithdrawalCompletedSchema } from '@nestfolio/broker-sim-adpt/contracts';
import { AlpacaOrderResultSchema, AlpacaTransferResultSchema, AlpacaAccountSnapshotSchema } from '@nestfolio/broker-alpaca-adpt/contracts';
import { expectContractMatch } from '../helpers/contract-assert';
// ... describe/beforeEach(onboarded + funded)/afterEach(cleanup) per the ledger gate ...
// ... it(A) SIM, it(B) REAL Alpaca paper with alpacaPaperReset + poll-SF cleanup ...
```

Fill in the two `it` blocks per the (A)/(B) description above, using `poll()` (deadline-based) for each row readback and `expectContractMatch(Schema, row, label)` for every assertion. Use generous timeouts (the real Alpaca order/transfer + polling SF take minutes — `420_000` per `it`, `600_000` beforeEach).

- [ ] **Step 2: Verify the e2e project lints/typechecks** (do NOT run against dev yet)

Run: `pnpm nx run e2e-feature-tests:lint`
Expected: PASS — all `@nestfolio/<svc>/contracts` imports resolve. If a producer's `package.json`/`project.json` lacks the `/contracts` subpath export, add it mirroring `@nestfolio/ledger-ctrl/contracts`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): execution producer-contract emission gate (SIM + real Alpaca paper)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

- [ ] **Step 4: File the real-paper-leak side-finding** (do not pivot — use `backlog-add`)

The broker-alpaca **integration** test (`SsmOverrideFixture` `restoreTo: paper-api`) + warm-Lambda SSM cache + long-lived poll SFs can hit REAL Alpaca paper after a test ends (root-caused the 2026-04-10 dashboard operation; corroborated by the April-11 `cold-start paper-only safety guard`). File a `parking` backlog item: "broker-alpaca integration/e2e can leak real-paper calls — harden SSM-cache flush + orphaned poll-SF teardown." Reference this plan's Task 5 mitigations.

---

### Task 6: Regenerate the 4 service cards (doc derivation)

The closing phase (`detect-doc-derivation.mjs`) flags the touched services. The broker-ctrl card is also **stale on funding event names** (`service-card-funding-event-type-drift`) — regen fixes it.

- [ ] **Step 1:** Run `audit-service broker-ctrl`, `audit-service broker-sim-adpt`, `audit-service broker-alpaca-adpt`, `audit-service execution-ctrl`; accept the regenerated "Contracts"/"Egress" sections (new schemas listed; broker-ctrl Egress funding names corrected to `NormalizedEvent`+`FundingEvent`).
- [ ] **Step 2: Commit**

```bash
git add services/execution/*/CLAUDE.md
git commit --no-verify -m "docs(execution): regen service cards for typed-subject contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Closing phase (driven by `/backlog-next` Step 6 — listed for completeness)

- [ ] **6.1 Doc derivation:** `node .claude/skills/backlog-next/detect-doc-derivation.mjs` → run flagged regens (Task 6 covers the service cards). Commit in this workstream.
- [ ] **6.2 Verify:** `pnpm nx affected -t test,lint,typecheck --base=origin/main` — green. (Expect the documented agent-orchestrator `@smithy` worktree-symlink false-FAIL — [[feedback-worktree-symlink-masks-test-failures]]; verify on real main post-merge.)
- [ ] **6.3 Detect deploy:** `node .claude/skills/backlog-next/detect-deploy-needed.mjs`. This slice is largely type-only (contracts + tests; `satisfies` annotations don't change emitted JS), so the producers already emit the asserted shapes — but the e2e gate drives the REAL deployed services, so **deploy the 4 services**: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=broker-ctrl,broker-sim-adpt,broker-alpaca-adpt,execution-ctrl`.
- [ ] **6.4 Run the gate (only the execution scenario):** `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns execution-contract-emission`. Must be GREEN against deployed dev. **If a contract mismatches the real row, FIX THE CONTRACT to match reality (the row is truth) — never loosen the row.** The real-Alpaca paper leg costs minutes + a real paper order/transfer; surface the cost via the gate's logs. If a scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing + run a confirmation pass ([[feedback-flake-means-broken]]). Confirm `alpacaPaperReset` + poll-SF cleanup ran (no orphaned executions polling real paper).
- [ ] **6.5–6.8:** Ship `docs/backlog/typed-subject-contracts-execution.md` (`status: shipped`, fill `validation_gate:` with commit SHAs + the e2e PASS line + unit-test counts); `backlog-lint --fix`; route to `superpowers:finishing-a-development-branch`; push `main`; git-clean the worktree + branch; postflight.

---

## Out of scope (mirrors the backlog file)

- `ProposedTrade` → zod conversion (Advisory slice 4; execution imports the interface UNCHANGED).
- WS-2 (`cdc-publisher-typed-subjects`) + WS-3 (`consumer-parse-subject` / `parseSubject` seams + cross-domain `execution-adpt/domain` re-export).
- Funding-completed normalization drift (`broker-funding-completed-normalization-drift`, `broker-ctrl-alpaca-funding-carrier-pk-divergence`) — funding is covered via `execution-adpt/domain` `FundingSnapshot`.
- The enforcement capstone (`typing-convention-enforcement-skills-docs`).
- Other domains (Ledger + Investor shipped; Advisory is slice 4).
- Runtime changes to emitted CONTEXT payloads beyond what typing requires.
- Deleting the dead `OrderRepository.createOrder`/`createStagedOrder` (`execution-ctrl-orderrepository-prune-unused-methods`); the latent broker-sim `status=REJECTED` dead Egress mapping.

## Self-Review

**Spec coverage** (design § "Execution (slice 3)"):
- broker-ctrl order-lifecycle contracts → Task 1 (`NormalizedOrderEvent` + `BrokerOrder` + `ExecutionMode`); funding excluded (covered via execution-adpt/domain). ✓
- broker-sim-adpt complete coverage → Task 2 (`VirtualTrade`, `SimWithdrawalCompleted` new; `SimDepositCompleted` kept; internal rows converted). ✓
- broker-alpaca-adpt Alpaca order/transfer contracts + (Q3) account-snapshot + circuit → Task 3. ✓
- execution-ctrl ORDER_CREATED / STAGED_ORDER_CREATED → Task 4 (`Order` + `StagedOrder`); ProposedTrade imported unchanged. ✓
- Home rule (producer `/contracts`; cross-domain re-export deferred to WS-3) → tsconfig paths added (Tasks 1/3/4; sim exists); ledger-slice precedent. ✓
- Conventions 3/4/5/6 (dry subjects, event-aligned names, `S` carried, rows → `TableEntry<Subject>`) → Tasks 1-4. ✓
- Validation against REAL emission, not fixtures → Task 5 (SIM real producer rows + REAL Alpaca paper). ✓ Producer unit tests + tsc → per-task + 6.2. ✓
- Depends on phase-0 taxonomy → uses `TableEntry<T,S>` / `RequestContext` / `{ tenantId }` / `SubjectContext`. ✓

**Placeholder scan:** every contracts task has complete schema + test code. Task 5's two `it` bodies are described step-by-step with the exact triggers/keys/schemas but left as a fill-in against the named ledger-gate template (the live-Alpaca leg is environment-dependent) — NOT a silent TODO: the triggers, table keys, schemas, safety steps, and timeouts are all specified. ✓

**Type consistency:** schema/type names used identically across tasks + the e2e imports — `NormalizedOrderEvent`, `BrokerOrder`, `ExecutionMode`, `VirtualTrade`, `SimWithdrawalCompleted`, `SimDepositCompleted`, `AlpacaOrderResult`, `AlpacaTransferResult`, `AlpacaAccountSnapshot`, `BrokerCircuitEvent`, `CircuitBreaker`, `Order`, `StagedOrder`. The reused type names (`AlpacaOrderResult` etc.) keep intra-service importers compiling; only the shape changed to dry. ✓
