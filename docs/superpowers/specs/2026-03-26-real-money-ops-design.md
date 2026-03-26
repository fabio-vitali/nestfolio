# Real Money Operations — Design Specification

**Date**: 2026-03-26
**Status**: Draft
**Scope**: Personal use — no KYC/AML, no regulatory filings, no multi-tenant compliance

## Context

Nestfolio currently operates in simulation-only mode. Orders are submitted through `execution-ctrl`, filled by `broker-adpt`'s `SimulationEngineService` (virtual ledger), and event-sourced into `ledger-ctrl`. This spec describes the architecture for real money trading via Alpaca, while preserving the simulation engine and maintaining broker-agnostic design.

## Key Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Broker | Alpaca first, broker-agnostic architecture | API-first, commission-free, developer-friendly |
| Funding | Programmatic ACH via Alpaca's API | Single integration point for trading + funding |
| Simulation | Keep Nestfolio's simulation engine (`broker-sim-adpt`) | Broker-agnostic testing; Alpaca paper trading would couple sim to broker |
| Service architecture | `broker-ctrl` (router/normalizer) + `broker-sim-adpt` + `broker-alpaca-adpt` | Anti-Corruption Layer: adapters speak native broker language, ctrl normalizes |
| Routing | `broker-ctrl` routes per-tenant based on `executionMode` | Both sim and live active simultaneously; per-tenant mode stored in investor profile |
| `executionMode` ownership | `investor-bff` persists on `InvestorProfile`, `broker-ctrl` caches via event subscription | BFF owns tenant state; mode is NOT cross-cutting (only broker-ctrl needs it for routing) |
| RequestContext | No `executionMode` — not cross-cutting, not always-important | Only 1 service (broker-ctrl) makes routing decisions based on it |
| Failure strategy | Smart auto-recovery for safe cases, escalate ambiguous | Retryable: auto-retry (max 3). Deterministic: immediate reject. Ambiguous: circuit breaker + escalate |
| Order polling | `broker-alpaca-adpt` polls Alpaca's SSE historical endpoint (`GET /v2/events/trades?since=X`) | No WebSockets/SSE streaming (requires always-on infra). Polling only while orders in-flight |
| Source of truth | Ledger is truth, Alpaca verified via reconciliation | Existing `reconciliation-ctrl` already implements this — no changes needed |
| Tax/cost basis | FIFO default, isolated in `TaxLotManager` within `ledger-ctrl` | IRS default; single interface boundary for future strategy changes |
| Sim-to-live transition | Clean slate — live starts fresh, sim data stays (soft boundary) | No migration logic, no stale sim positions replicated at wrong prices |
| Re-onboarding | "Go Live" reuses onboarding phases (risk profile, goals, mandate) | User may adjust risk tolerance when real money is at stake |
| EventBridge API Destinations | Not used — Lambda only | Every Alpaca call needs response processing; API Destinations are fire-and-forget |

## Deferred Concerns

- **Security pass**: Credential handling, zero-trust design, encryption at rest/in transit, secret management for Alpaca API keys. Separate design session.
- **Broker account transparency**: Ensuring system state and broker state never silently diverge. Covered in security pass.

---

## 1. Event Flow & Service Topology

### Current flow (simulation only)

```
execution-ctrl → CDC: ORDER_SUBMITTED → broker-adpt (simulates)
  → CDC: VIRTUAL_TRADE_CREATED (convention) → event-publisher transforms → ORDER_FILLED on ExecutionBus
  → execution-adpt → ledger/investor
```

> **Note**: broker-adpt's CDC uses `buildEventTypeMap` convention (`VirtualTrade:INSERT` → `VIRTUAL_TRADE_CREATED`), with custom overrides for `DepositDetected:INSERT` → `DEPOSIT_DETECTED` and `WithdrawalCompleted:INSERT` → `WITHDRAWAL_COMPLETED`. The event-publisher handler transforms and publishes as canonical `ORDER_FILLED` to ExecutionBus.

### New flow

```
execution-ctrl → CDC: ORDER_SUBMITTED
                        |
                   broker-ctrl
              (reads cached executionMode)
                   /          \
  SIM_ORDER_REQUESTED    ALPACA_ORDER_REQUESTED
        |                       |
  broker-sim-adpt         broker-alpaca-adpt
        |                       |
  SIM_ORDER_FILLED        ALPACA_ORDER_FILLED
  SIM_ORDER_REJECTED      ALPACA_ORDER_REJECTED
                   \          /
                   broker-ctrl
            (failure classification)
            (circuit breaker check)
               (normalizes)
                     |
            ORDER_FILLED / ORDER_REJECTED (CDC)
                     |
               execution-adpt (unchanged)
                   /      \
             LedgerBus   InvestorBus
```

### Deposit/withdrawal flow (same pattern)

```
investor-bff → CDC: DEPOSIT_INITIATED / WITHDRAWAL_REQUESTED
                        |
                   broker-ctrl
                   /          \
  SIM_DEPOSIT_INITIATED    ALPACA_TRANSFER_REQUESTED
        |                         |
  broker-sim-adpt           broker-alpaca-adpt
  (credits virtual cash)    (initiates ACH via Alpaca API)
        |                         |
  SIM_DEPOSIT_COMPLETED     ALPACA_TRANSFER_COMPLETED
                   \          /
                   broker-ctrl
               (normalizes)
                     |
           DEPOSIT_DETECTED / WITHDRAWAL_COMPLETED (CDC)
```

### EventBridge bus placement

All three services (`broker-ctrl`, `broker-sim-adpt`, `broker-alpaca-adpt`) live on **ExecutionBus**. Routed events (`SIM_*`, `ALPACA_*`) are internal to the execution domain — they never cross bus boundaries. Only normalized canonical events (`ORDER_FILLED`, etc.) fan out via `execution-adpt`.

### Service inventory

**New services:**
- `broker-ctrl` — Execution domain. Routes orders, normalizes broker events, failure classification, circuit breaker, order state machine. **Deliberate exception to the stateless-controller convention**: broker-ctrl requires its own DynamoDB table for order state machine, circuit breaker state, and execution mode cache. This is justified — it is an orchestration service with state machine semantics, not a typical event processor. The `-ctrl` suffix is retained for consistency with the execution domain naming, but this service owns state.
- `broker-alpaca-adpt` — Execution domain. Thin Alpaca API wrapper + internal event polling

**Modified services:**
- `broker-adpt` → `broker-sim-adpt` — Rename, emit sim-specific events instead of canonical ones
- `investor-bff` — Add `executionMode` field to `InvestorProfile` (default: `'simulation'` for existing profiles)
- `ledger-ctrl` — Add `TaxLotManager` (FIFO lot tracking)
- `onboarding-bff` — "Go Live" re-onboarding flow (`flowType: 'initial' | 'go-live'`)
- `execution-adpt` — Add forwarding rules for `ORDER_ESCALATED` and `BROKER_CIRCUIT_OPEN` (ExecutionBus → InvestorBus)
- `investor-adpt` — Add forwarding rules for `ALPACA_CREDENTIALS_PROVIDED` and `EXECUTION_MODE_CHANGED` (InvestorBus → ExecutionBus)
- `reconciliation-ctrl` — Add subscription to `ALPACA_ACCOUNT_SNAPSHOT` for broker-reported position verification

**Unchanged services:**
- Execution: `execution-ctrl`
- Advisory: `compliance-ctrl`, `decision-workflow-ctrl`, `portfolio-engine-ctrl`
- Ledger: `ledger-bff`
- Investor: `dashboard-bff`, `investor-ctrl`
- All hubs, all market data adapters

> **Naming note**: `EXECUTION_MODE_CHANGED` (sim vs. live trading mode) is distinct from the existing `OPERATING_MODE_CHANGED` (conservative/balanced/aggressive advisory style). They are semantically different — execution mode controls order routing, operating mode controls advisory behavior.

---

## 2. broker-ctrl Internals

### Order State Machine

Every order tracked by `broker-ctrl` goes through a state machine persisted in its DynamoDB table.

```
                    ORDER_SUBMITTED received
                            |
                       [ROUTING] (determine sim or live)
                            |
                  emit SIM_* or ALPACA_*
                            |
                    [AWAITING_FILL]
                            |
              +-------------+--- ALPACA_ORDER_PLACED received?
              |                  -> update alpacaOrderId on record (stay in AWAITING_FILL)
              |
              +------+------+----------+
              |      |      |          |
           FILLED  PARTIAL  REJECTED   CANCEL_REQUESTED
              |      |      /FAILED       |
         normalize  update    |      emit ALPACA_ORDER_CANCEL_REQUESTED
              |    qty & wait |      or SIM cancel
              |      |        |           |
       ORDER_FILLED  |   classify     CANCELLED / CANCEL_FAILED
              |      |   failure         |           |
              |      |      |        normalize    normalize
              |      |  [RETRYABLE?]     |           |
              |      |    /     \   ORDER_CANCELLED  ORDER_REJECTED
              |      |  yes      no
              |      |   |        |
              |      | re-emit [ESCALATED]
              |      | (max 3)    |
              |      |   |    notify user
              |      |   |
              | ORDER_PARTIALLY_FILLED
              | (emitted for each partial fill;
              |  ORDER_FILLED when full qty reached)
```

### DynamoDB entities

```
pk: BrokerOrder#{tenantId}#{orderId}
sk: BrokerOrder

{
  tenantId, orderId, executionMode,
  state: ROUTING | AWAITING_FILL | FILLED | PARTIALLY_FILLED | REJECTED | FAILED | ESCALATED | CANCEL_REQUESTED | CANCELLED,
  routedTo: 'sim' | 'alpaca',
  routedEventId: string,
  alpacaOrderId: string | null,   // set when ALPACA_ORDER_PLACED received

  // fill tracking
  requestedQty, filledQty, remainingQty,
  fills: [{ qty, price, timestamp }],

  // failure tracking
  retryCount: number,
  lastFailureReason: string,
  failureClass: 'transient' | 'deterministic' | 'ambiguous',

  // circuit breaker reference
  instrumentId: string,

  // timing
  routedAt, lastUpdateAt, timeoutAt
}
```

### Failure Classification

When `broker-ctrl` receives a rejected/failed event from any adapter:

| Failure | Class | Action |
|---------|-------|--------|
| API timeout, 5xx, rate limit | **transient** | Re-emit routed event, max 3 retries with exponential backoff (5s, 15s, 45s) |
| Insufficient buying power | **deterministic** | No retry. Normalize to `ORDER_REJECTED` with human-readable reason |
| Symbol halted / delisted | **deterministic** | No retry. Normalize to `ORDER_REJECTED` with reason |
| Invalid order params | **deterministic** | No retry. Normalize to `ORDER_REJECTED` |
| No response within timeout | **ambiguous** | Circuit breaker on instrument. State -> `ESCALATED`. Emit `ORDER_ESCALATED` to InvestorBus |
| Broker unreachable | **ambiguous** | Global circuit breaker. All pending routings paused. Emit `BROKER_CIRCUIT_OPEN` to InvestorBus |

Failure reason mapping lives in `broker-ctrl` — each broker adapter returns its raw error, `broker-ctrl` classifies. Adding a new broker doesn't require reimplementing failure classification.

### Circuit Breaker

```
pk: CircuitBreaker#{tenantId}
sk: Instrument#{symbol} | Global

{
  state: CLOSED | OPEN,
  openedAt, reason,
  openedByOrderId,
  pendingOrderIds: []   // orders queued while breaker is open
}
```

**Behavior:**
- **CLOSED** (normal): orders route normally
- **OPEN**: new orders for that instrument (or all if global) held in `pendingOrderIds`
- **Auto-close conditions:**
  - Instrument breaker: fill or rejection received for the stuck order
  - Global breaker: Step Functions Express Workflow started on `BROKER_CIRCUIT_OPEN`, polls `ALPACA_ACCOUNT_CHECK` every 60s via broker-alpaca-adpt. Closes breaker on successful `ALPACA_ACCOUNT_SNAPSHOT` response. Escalates to user after 10 consecutive failures.
- **On close:** pending orders re-routed automatically

### Retry Mechanism

Retries use **Step Functions Express Workflow wait states** (sub-minute waits are free on Express, expensive on Standard) — no polling loops:

```
broker-ctrl classifies as retryable
  -> writes retryCount + 1 to DDB
  -> starts SF Express execution: Wait(backoff) -> emit SIM_*/ALPACA_* again
```

### Order Timeout Detection

For live orders, `broker-ctrl` starts a Step Functions execution when it routes:

```
Route order -> Start SF: Wait(configurable, e.g. 5min) -> Check order state in DDB
  -> if still AWAITING_FILL -> classify as ambiguous -> circuit breaker
  -> if resolved -> no-op (SF terminates)
```

---

## 3. broker-alpaca-adpt

### Responsibilities

Thin Alpaca API wrapper + internal event polling. No failure classification, no circuit breakers — just translates between Nestfolio routed events and Alpaca's REST/SSE API. All intelligence lives in `broker-ctrl`.

### Alpaca API Surface

| Alpaca API | Purpose | When |
|------------|---------|------|
| `POST /v2/orders` | Submit order | `ALPACA_ORDER_REQUESTED` |
| `DELETE /v2/orders/{id}` | Cancel order | `ALPACA_ORDER_CANCEL_REQUESTED` |
| `GET /v2/events/trades?since=X&until=Y` | Batch poll all trade events | Internal scheduled poll |
| `GET /v2/account` | Account balance/status | Reconciliation, health check |
| `GET /v2/positions` | Current positions | Reconciliation |
| `POST /v2/ach/relationships` | Link bank account | "Go Live" onboarding |
| `POST /v2/ach/transfers` | Initiate ACH transfer | `ALPACA_TRANSFER_REQUESTED` |
| `GET /v2/ach/transfers/{id}` | Transfer status | Internal scheduled poll |

### Event Handling

**Inbound (from broker-ctrl via ExecutionBus):**

| Event | Action | Outbound (CDC) |
|-------|--------|----------------|
| `ALPACA_ORDER_REQUESTED` | `POST /v2/orders` | `ALPACA_ORDER_PLACED` (with Alpaca orderId) |
| `ALPACA_ORDER_CANCEL_REQUESTED` | `DELETE /v2/orders/{id}` | `ALPACA_ORDER_CANCELLED` or `ALPACA_ORDER_CANCEL_FAILED` |
| `ALPACA_TRANSFER_REQUESTED` | `POST /v2/ach/transfers` | `ALPACA_TRANSFER_INITIATED` |
| `ALPACA_ACCOUNT_CHECK` | `GET /v2/account` + `GET /v2/positions` | `ALPACA_ACCOUNT_SNAPSHOT` |

**Self-initiated (internal polling):**

| Trigger | Action | Outbound (CDC) |
|---------|--------|----------------|
| EventBridge Scheduler (every 15-30s while orders in-flight) | `GET /v2/events/trades?since=X` | `ALPACA_ORDER_FILLED` / `ALPACA_ORDER_PARTIALLY_FILLED` / `ALPACA_ORDER_REJECTED` |
| EventBridge Scheduler (every 5min while transfers pending) | `GET /v2/ach/transfers/{id}` | `ALPACA_TRANSFER_COMPLETED` / `ALPACA_TRANSFER_FAILED` (no event emitted if still pending — polling continues) |

### Polling Mechanism

**Trade event polling:**

```
ALPACA_ORDER_PLACED written to DDB
  -> CDC triggers EventBridge Scheduler rule (rate: 30s)
  -> Lambda: GET /v2/events/trades?since={lastCheckedAt}&until={now}
  -> For each event: match to Nestfolio orderId via order-mapping table
  -> Emit ALPACA_ORDER_FILLED / REJECTED / PARTIALLY_FILLED
  -> Update lastCheckedAt
  -> If zero open orders remain -> disable scheduler rule
```

Smart frequency: scheduler only active while orders are in-flight. No open orders = no polling = no cost.

Transfer polling: same pattern but slower cadence (ACH transfers take hours/days).

### Alpaca Authentication

Two static headers per request:
- `APCA-API-KEY-ID`: API key ID
- `APCA-API-SECRET-KEY`: API key secret

Alpaca endpoints:
- Paper: `https://paper-api.alpaca.markets`
- Live: `https://api.alpaca.markets`

### DynamoDB Entities

```
pk: OrderMapping#{tenantId}#{nestfolioOrderId}
sk: OrderMapping
{ nestfolioOrderId, alpacaOrderId, symbol, side, status, submittedAt }

pk: AlpacaCredentials#{tenantId}
sk: AlpacaCredentials
{ apiKeyId, secretManagerArn, environment, baseUrl, achRelationshipId }

pk: PollingState#{tenantId}
sk: PollingState
{ lastCheckedAt, openOrderCount, schedulerRuleArn }
```

Note: `apiKeySecret` stored in AWS Secrets Manager — table holds ARN only. Full credential security design deferred to security pass.

### Service Structure

```
broker-alpaca-adpt/
  src/
    service.stack.ts
    handlers/
      event-listener.ts            # Inbound routed events
      trade-event-poller.ts        # Scheduled: polls GET /v2/events/trades
      transfer-status-poller.ts    # Scheduled: polls transfer status
    services/
      alpaca-orders.service.ts
      alpaca-transfers.service.ts
      alpaca-account.service.ts
    clients/
      alpaca.client.ts             # HTTP client: auth headers, base URL, raw error passthrough
    repositories/
      credentials.repository.ts
      order-mapping.repository.ts
      polling-state.repository.ts
  test/
    ...
```

---

## 4. broker-sim-adpt (renamed from broker-adpt)

### Changes

Rename + event type swap. Simulation engine logic stays as-is.

| Aspect | Before (broker-adpt) | After (broker-sim-adpt) |
|--------|----------------------|------------------------|
| Service name | `broker-adpt` | `broker-sim-adpt` |
| Subscribes to | `ORDER_SUBMITTED` | `SIM_ORDER_REQUESTED` |
| Emits (CDC) | `VIRTUAL_TRADE_CREATED` (transformed to `ORDER_FILLED` by event-publisher), `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED` | `SIM_ORDER_FILLED`, `SIM_ORDER_REJECTED`, `SIM_DEPOSIT_COMPLETED`, `SIM_WITHDRAWAL_COMPLETED` |
| Business logic | SimulationEngineService | **Unchanged** |
| Virtual ledger | VirtualLedgerRepository | **Unchanged** |
| Market data | CachedMarketDataProvider | **Unchanged** |

### Inbound Events

| Event | Action | Outbound (CDC) |
|-------|--------|----------------|
| `SIM_ORDER_REQUESTED` | Run SimulationEngineService (validate balance/position, simulate fill) | `SIM_ORDER_FILLED` or `SIM_ORDER_REJECTED` |
| `SIM_DEPOSIT_INITIATED` | Credit virtual cash balance | `SIM_DEPOSIT_COMPLETED` |
| `SIM_WITHDRAWAL_REQUESTED` | Debit virtual cash balance | `SIM_WITHDRAWAL_COMPLETED` |

### CDC Event Type Mapping Update

Current broker-adpt uses `buildEventTypeMap` convention + custom overrides. broker-sim-adpt replaces with explicit `customEventTypeMap`:

```
VirtualTrade:INSERT    -> SIM_ORDER_FILLED       (was VIRTUAL_TRADE_CREATED, transformed to ORDER_FILLED)
VirtualTrade:INSERT    -> SIM_ORDER_REJECTED     (new — rejected trades need explicit status-based mapping)
DepositDetected:INSERT -> SIM_DEPOSIT_COMPLETED  (was DEPOSIT_DETECTED)
WithdrawalCompleted:INSERT -> SIM_WITHDRAWAL_COMPLETED (was WITHDRAWAL_COMPLETED)
```

> **Migration note**: The current event-publisher handler in broker-adpt transforms `VIRTUAL_TRADE_CREATED` → `ORDER_FILLED`. broker-sim-adpt replaces this with a direct `customEventTypeMap` that emits `SIM_ORDER_FILLED` without the intermediate transformation.

### Migration Risk

Low. Rename + event type changes only. Simulation engine is proven and tested.

---

## 5. broker-ctrl State & "Go Live" Flow

### DynamoDB Entities

```
# Order tracking (Section 2)
pk: BrokerOrder#{tenantId}#{orderId}
sk: BrokerOrder

# Circuit breaker (Section 2)
pk: CircuitBreaker#{tenantId}
sk: Instrument#{symbol} | Global

# Execution mode cache
pk: ExecutionMode#{tenantId}
sk: ExecutionMode
{ mode: 'simulation' | 'live', updatedAt }
```

### Execution Mode Lifecycle

```
investor-bff (source of truth)
  -> CDC: EXECUTION_MODE_CHANGED { tenantId, mode }
  -> InvestorBus
  -> broker-ctrl subscribes
  -> writes/updates ExecutionMode#{tenantId}
```

On every `ORDER_SUBMITTED`, broker-ctrl reads its local table — single DynamoDB `GetItem`, sub-millisecond.

### "Go Live" User Journey

**Step 1 — Initiate (onboarding-bff, flowType: 'go-live')**

User taps "Switch to Live Trading" in investor-mfe. Triggers re-onboarding:

| Phase | Description | Reuses existing? |
|-------|-------------|-----------------|
| 1. Connect Alpaca | OAuth or API key entry. Verify connection via `ALPACA_ACCOUNT_CHECK` | New |
| 2. Review risk profile | Show current, let user adjust. Real money may change tolerance | Existing onboarding phase |
| 3. Review investment goals | Show current, let user adjust | Existing onboarding phase |
| 4. Review mandate & guardrails | Advisory vs. discretionary, concentration limits, turnover caps | Existing onboarding phase |
| 5. Fund account | Link bank via Alpaca ACH, initiate transfer, wait for confirmation | New |
| 6. Confirm switch | Summary screen, user confirms | New |

**Step 2 — Mode switch (investor-bff)**

On confirmation, `onboarding-bff` emits `GO_LIVE_CONFIRMED`. `investor-bff` receives:
1. Updates `InvestorProfile.executionMode = 'live'`
2. Updates risk profile, goals, mandate if changed
3. CDC emits `EXECUTION_MODE_CHANGED`

**Step 3 — Downstream reactions**

| Service | Receives | Action |
|---------|----------|--------|
| `broker-ctrl` | `EXECUTION_MODE_CHANGED` | Updates cached mode. Next order routes to `broker-alpaca-adpt` |
| `dashboard-bff` | `EXECUTION_MODE_CHANGED` | Materializes mode for UI display (sim vs. live badge) |

**Step 4 — First real trade**

Portfolio is empty. `portfolio-engine-ctrl` generates normal rebalancing recommendations based on risk profile + empty portfolio. No special migration logic. User reviews, approves, orders execute through Alpaca.

### Sim Data on Switch

No cleanup. Live starts with a fresh ledger stream (sequence 0, empty positions). Sim data stays in its stream — naturally invisible to all live queries. Soft boundary, zero risk.

### Re-onboarding UX

`onboarding-bff` gains a `flowType: 'initial' | 'go-live'` parameter:
- **`initial`**: Full 7-phase wizard (existing behavior)
- **`go-live`**: Phases 1-6 above (skip account creation/identity, pre-fill from current profile, add Alpaca/funding phases)

Entry point: investor-mfe settings page, not signup flow.

---

## 6. TaxLotManager in ledger-ctrl

### Purpose

Isolated concern for FIFO tax lot tracking. The single interface boundary for all cost-basis, gain/loss, and holding period logic.

### Tax Lot Entity

```
pk: TaxLot#{tenantId}
sk: Lot#{symbol}#{lotId}

{
  lotId,                // ulid, ordered by creation time
  symbol,
  quantity,             // remaining shares (decremented on sells)
  originalQuantity,
  costBasisPerShare,    // cents, price at acquisition
  acquiredAt,           // timestamp, for short-term vs. long-term (1yr threshold)
  orderId,              // order that created this lot
  status: 'open' | 'closed'
}
```

### Disposition Record

```
pk: Disposition#{tenantId}
sk: Disposition#{year}#{dispositionId}

{
  dispositionId,
  symbol,
  qtySold,
  costBasisPerShare,
  sellPricePerShare,
  realizedGainCents,      // positive = gain, negative = loss
  holdingPeriod: 'short-term' | 'long-term',
  acquiredAt,
  disposedAt,
  lotId,
  orderId
}
```

### Behavior

**On BUY fill:**
```
ORDER_FILLED (side=BUY, qty=50, price=150.00)
  -> TaxLotManager.openLot({ symbol, qty: 50, costBasis: 150.00, acquiredAt })
  -> Creates one new TaxLot record
```

**On SELL fill (FIFO):**
```
ORDER_FILLED (side=SELL, qty=80, price=170.00)
  -> TaxLotManager.closeLots({ symbol, qty: 80, price: 170.00 })
  -> FIFO: consume oldest lots first
    Lot#001: 50 shares -> close fully, remainingToSell = 30
    Lot#002: 100 shares -> reduce by 30, remainingToSell = 0
  -> Compute per-lot: holdingPeriod, realizedGain
  -> Write DispositionRecord(s)
```

### Interface

```typescript
interface TaxLotManager {
  openLot(params: OpenLotParams): Promise<void>
  closeLots(params: CloseLotParams): Promise<DispositionRecord[]>
  getLotsBySymbol(tenantId: string, symbol: string): Promise<TaxLot[]>
  getDispositions(tenantId: string, year: number): Promise<DispositionRecord[]>
  getUnrealizedGains(tenantId: string): Promise<UnrealizedGainRecord[]>
}
```

Future changes (specific lot ID, wash-sale, tax-loss harvesting) modify `closeLots()` strategy only.

### Integration

Runs alongside existing account reducer — same event trigger, parallel concern, independent storage:

```
ORDER_FILLED received by ledger-ctrl
  -> accountReducer.apply(event)       // position summary (unchanged)
  -> taxLotManager.openLot/closeLots   // lot tracking (new)
```

Tax lots only apply to live fills. `broker-ctrl` includes `executionMode` in the normalized `ORDER_FILLED` payload. `ledger-ctrl` reads this field: if `executionMode === 'live'`, invoke `TaxLotManager`; if `'simulation'`, skip. This is the only field `broker-ctrl` adds to the canonical event schema beyond the existing fields.

---

## 7. Re-onboarding UX

### Entry Point

Settings page in `investor-mfe` with a "Switch to Live Trading" CTA. Only visible when `executionMode === 'simulation'`.

### Flow (onboarding-mfe, flowType: 'go-live')

**Screen 1 — Connect Broker**
- Alpaca API key input (or OAuth if supported)
- "Test Connection" button -> verifies via `ALPACA_ACCOUNT_CHECK`
- Success: show account status, buying power
- Failure: show error, let user retry

**Screen 2 — Review Risk Profile**
- Pre-filled with current simulation risk profile
- Highlight: "You set this during simulation. Now that real money is involved, would you like to adjust?"
- Same risk assessment UI as initial onboarding

**Screen 3 — Review Goals**
- Pre-filled current goals
- Same goal-setting UI as initial onboarding

**Screen 4 — Review Mandate & Guardrails**
- Pre-filled current mandate (advisory vs. discretionary)
- Pre-filled guardrails (concentration limits, turnover caps)
- Highlight: "These guardrails control what the system can do autonomously with real money"

**Screen 5 — Fund Account**
- Link bank account (Alpaca ACH relationship)
- Enter transfer amount
- Initiate transfer
- Show transfer status (polling via `broker-alpaca-adpt`)
- Wait for funding confirmation before proceeding

**Screen 6 — Confirmation**
- Summary: broker connected, amount funded, risk profile, mandate, guardrails
- Clear warning: "From this point, all trades will use real money"
- Confirm button -> emits `GO_LIVE_CONFIRMED`

### Post-Switch Dashboard

`dashboard-bff` materializes a "LIVE" badge. Portfolio view shows empty state with advisory recommendations loading.

---

## Appendix: Event Type Registry

### New Events (Execution Domain Internal)

| Event | Source | Consumer |
|-------|--------|----------|
| `SIM_ORDER_REQUESTED` | broker-ctrl | broker-sim-adpt |
| `SIM_ORDER_FILLED` | broker-sim-adpt (CDC) | broker-ctrl |
| `SIM_ORDER_REJECTED` | broker-sim-adpt (CDC) | broker-ctrl |
| `SIM_DEPOSIT_INITIATED` | broker-ctrl | broker-sim-adpt |
| `SIM_DEPOSIT_COMPLETED` | broker-sim-adpt (CDC) | broker-ctrl |
| `SIM_WITHDRAWAL_REQUESTED` | broker-ctrl | broker-sim-adpt |
| `SIM_WITHDRAWAL_COMPLETED` | broker-sim-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_REQUESTED` | broker-ctrl | broker-alpaca-adpt |
| `ALPACA_ORDER_PLACED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_FILLED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_PARTIALLY_FILLED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_REJECTED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_CANCEL_REQUESTED` | broker-ctrl | broker-alpaca-adpt |
| `ALPACA_ORDER_CANCELLED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ORDER_CANCEL_FAILED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_TRANSFER_REQUESTED` | broker-ctrl | broker-alpaca-adpt |
| `ALPACA_TRANSFER_INITIATED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_TRANSFER_COMPLETED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_TRANSFER_FAILED` | broker-alpaca-adpt (CDC) | broker-ctrl |
| `ALPACA_ACCOUNT_CHECK` | broker-ctrl | broker-alpaca-adpt |
| `ALPACA_ACCOUNT_SNAPSHOT` | broker-alpaca-adpt (CDC) | broker-ctrl, reconciliation-ctrl |

### New Events (Cross-Domain)

| Event | Source | Bus Route | Consumer |
|-------|--------|-----------|----------|
| `EXECUTION_MODE_CHANGED` | investor-bff (CDC) | InvestorBus → ExecutionBus (via investor-adpt) | broker-ctrl, dashboard-bff |
| `GO_LIVE_CONFIRMED` | onboarding-bff (CDC) | InvestorBus | investor-bff |
| `ORDER_ESCALATED` | broker-ctrl (CDC) | ExecutionBus → InvestorBus (via execution-adpt) | investor-ctrl (notification) |
| `BROKER_CIRCUIT_OPEN` | broker-ctrl (CDC) | ExecutionBus → InvestorBus (via execution-adpt) | investor-ctrl (notification) |
| `ALPACA_CREDENTIALS_PROVIDED` | onboarding-bff (CDC) | InvestorBus → ExecutionBus (via investor-adpt) | broker-alpaca-adpt |
| `ALPACA_ACCOUNT_VERIFIED` | broker-alpaca-adpt (CDC) | ExecutionBus → InvestorBus (via execution-adpt) | onboarding-bff |
| `ALPACA_ACCOUNT_VERIFICATION_FAILED` | broker-alpaca-adpt (CDC) | ExecutionBus → InvestorBus (via execution-adpt) | onboarding-bff |

### Modified Events

| Event | Change |
|-------|--------|
| `ORDER_FILLED` | Now emitted by broker-ctrl (was broker-adpt). Schema adds `executionMode` field. |
| `ORDER_PARTIALLY_FILLED` | Now emitted by broker-ctrl (was broker-adpt). Emitted for each partial fill as it arrives. Schema adds `executionMode` field. |
| `ORDER_REJECTED` | Now emitted by broker-ctrl (was broker-adpt). Same schema. |
| `ORDER_CANCELLED` | Now emitted by broker-ctrl (normalizes from `ALPACA_ORDER_CANCELLED` or sim cancel). Same schema. |
| `DEPOSIT_DETECTED` | Now emitted by broker-ctrl (was broker-adpt). Same schema. |
| `WITHDRAWAL_COMPLETED` | Now emitted by broker-ctrl (was broker-adpt). Same schema. |
