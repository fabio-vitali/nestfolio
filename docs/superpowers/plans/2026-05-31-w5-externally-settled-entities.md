# w5 — Externally-settled entities (deposits/withdrawals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `broker-ctrl` (Execution) the single owner of the deposit/withdrawal funding lifecycle, emitting versioned semantic lifecycle events; turn investor-bff `Deposit`/`WithdrawalRequest` rows into P1 versioned projections fed only by those events; route `initiateDeposit`/`requestWithdrawal` through an intent outbox; and adjust cash in `ledger-ctrl` on settlement — fixing the deposit/withdrawal-settlement-never-persisted latent bug by construction.

**Architecture:** A new per-transfer carrier-row family `Funding#<tid>#<transferId>` (sk = lifecycle event name) in broker-ctrl, each row carrying the full funding snapshot + a status-ordinal `__version`. CDC `field:'sk', passthrough` emits distinct semantic events (`DEPOSIT_REQUESTED|DETECTED|SETTLED|FAILED`, `WITHDRAWAL_REQUESTED|SETTLED|FAILED`). investor-bff projects them via `projectVersioned`. ledger-ctrl applies cash on `*_SETTLED`. The deposit/withdrawal intents become outbox rows (`DepositIntent`/`WithdrawalIntent`) whose CDC emits `DEPOSIT_INITIATED`/`WITHDRAWAL_INITIATED`.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (intents: `record`, `projectVersioned`; pipelines: `materializeToTable`, `createIngestionHandler`), AWS CDK 6-construct pattern (`State`/`Ingress`/`Egress`/`Facade`), DynamoDB single-table + Streams CDC, EventBridge, AppSync JS resolvers, Jest (unit + integration via `@nestfolio/integration-testing` + `@nestfolio/test-support`), nx.

---

## Conventions for every task

- **Worktree path.** cwd is the worktree `…/.claude/worktrees/feat+bff-readmodel-w5-externally-settled-entities`. The Edit/Write tools resolve absolute paths against MAIN's checkout, so **every file path below is repo-relative**; resolve it under the worktree root, never the original repo root.
- **Run tests through nx.** `pnpm nx test <project>` (unit), `pnpm nx run <project>:test-integration` (integration). Never call jest directly.
- **TDD.** Write the failing test, run it red, implement, run it green, commit. Each numbered step is one action.
- **Commit messages** end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No deprecation.** Dev is disposable; rename freely, delete dead code, do not keep back-compat shims unless a step says so.

## Event-name contract (the single source of truth for this plan)

Intents (investor-bff emits → broker-ctrl consumes):
- `DEPOSIT_INITIATED` (unchanged name; now from `DepositIntent` row, not `Deposit`)
- `WITHDRAWAL_INITIATED` (**renamed** from `WITHDRAWAL_REQUESTED`)

Lifecycle (broker-ctrl emits → investor-bff projects, ledger consumes settled):
- `DEPOSIT_REQUESTED` (v1), `DEPOSIT_DETECTED` (v2), `DEPOSIT_SETTLED` (v3), `DEPOSIT_FAILED` (v3)
- `WITHDRAWAL_REQUESTED` (v1), `WITHDRAWAL_SETTLED` (v3), `WITHDRAWAL_FAILED` (v3) — no `DETECTED` (no external arrival step)

`__version` = status ordinal: requested=1, detected=2, settled|failed=3.

`TRANSFER_FAILED` is **removed** (replaced by `DEPOSIT_FAILED`/`WITHDRAWAL_FAILED`).

Cash-affecting terminal: ledger consumes `DEPOSIT_SETTLED` + `WITHDRAWAL_SETTLED` (was `DEPOSIT_DETECTED` + `WITHDRAWAL_COMPLETED`).

---

## File structure (created / modified)

**broker-ctrl** (`services/execution/broker-ctrl`)
- Create `src/domain/funding.ts` — Funding snapshot type + `STATUS_ORDINAL` + `fundingCarrier()` builder.
- Create `src/repositories/funding.repository.ts` — `getCarrier(transferId, eventName)` read for carry-forward.
- Modify `src/domain/events.ts` — new lifecycle + intent names; drop `TRANSFER_FAILED`/`WITHDRAWAL_COMPLETED`/`DEPOSIT_DETECTED` from outbound where superseded; rename inbound `WITHDRAWAL_REQUESTED`→`WITHDRAWAL_INITIATED`.
- Modify `src/handlers/deposit-withdrawal-router.ts` — write `requested` carrier (v1) + route.
- Modify `src/handlers/deposit-withdrawal-normalizer.ts` — read requested carrier, write detected/settled/failed carriers.
- Modify `src/service.stack.ts` — `FundingEvent` egress (passthrough on sk); ingress rename; grant table read to router/normalizer.
- Tests: `test/unit/funding.test.ts` (new), update `test/unit/deposit-withdrawal-normalizer.test.ts`, `test/unit/deposit-withdrawal-router.test.ts`, `test/unit/service.stack.test.ts`, `test/integration/broker-ctrl.integration.test.ts`.

**ledger-ctrl** (`services/ledger/ledger-ctrl`)
- Modify `src/domain/account.reducer.ts` — case keys `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED`; `depositedAt`/`withdrawnAt` ← `settledAt`; withdrawal reads `amountCents`.
- Modify `src/handlers/event-listener.ts` — `ACTUAL_EVENT_TYPES` settled names.
- Modify `src/service.stack.ts` — Ingress subscribes settled names.
- Tests: update `test/unit/domain/account.reducer.test.ts`, `test/integration/ledger-ctrl.integration.test.ts`.

**ledger-adpt** (`services/ledger/ledger-adpt`)
- Modify `src/domain/events.ts` + `src/service.stack.ts` — forward `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED` (drop `DEPOSIT_DETECTED`/`WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED` for cash; keep `DEPOSIT_DETECTED` only if still needed downstream — it is not for ledger).

**investor-adpt** (`services/investor/investor-adpt`)
- Modify `src/domain/events.ts` + `src/service.stack.ts` — forward new lifecycle names to investor bus (`DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED`, `WITHDRAWAL_REQUESTED/SETTLED/FAILED`); rename `WITHDRAWAL_REQUESTED` intent → `WITHDRAWAL_INITIATED` on the outbound-to-execution side.

**advisory-adpt** (`services/advisory/advisory-adpt`)
- Modify if it forwards `DEPOSIT_DETECTED` — keep `DEPOSIT_DETECTED` forwarding (still emitted); no settled needed.

**investor-bff** (`services/investor/investor-bff`)
- Modify `src/read-model-ownership.ts` — `Deposit`/`WithdrawalRequest` → `Projection<'P1'>`; add `DepositIntent`/`WithdrawalIntent` (CommandOwned, outbox).
- Modify `src/domain/events.ts` — lifecycle inbound names; rename withdrawal intent.
- Create `src/transforms/deposit-lifecycle.ts` + `src/transforms/withdrawal-lifecycle.ts` — projectVersioned transforms.
- Modify `src/handlers/event-listener.ts` — register the two transforms; ingress for lifecycle events.
- Modify `src/graphql/js-function/initiate-deposit.fn.js` — write `DepositIntent` outbox row; return synthetic optimistic `Deposit`.
- Modify `src/graphql/js-function/request-withdrawal.fn.js` — `ConditionCheck` CashBalance (read-only) + write `WithdrawalIntent`; return synthetic optimistic `WithdrawalRequest`.
- Delete `src/graphql/js-function/publish-deposit-event.fn.js`; remove `publishDepositEvent` mutation + `DepositEvent`/`onDepositEvent` subscription from `src/schema.graphql`.
- Modify `src/handlers/broadcast-listener.ts` — remove the `DEPOSIT_DETECTED → publishDepositEvent` broadcast (retire dual-writer).
- Modify `src/transforms/onboarding-completed.ts` — replace the `Deposit` seed Put with a `DepositIntent` outbox Put.
- Modify `src/service.stack.ts` — egress: `DepositIntent`/`WithdrawalIntent` insert→intent; remove `Deposit`/`Withdrawal` egress; ingress: add lifecycle events to a projection ingress; broadcast ingress drops `DEPOSIT_DETECTED`.
- Tests: new `test/unit/transforms/deposit-lifecycle.test.ts`, `test/unit/transforms/withdrawal-lifecycle.test.ts`; update `test/unit/handlers/broadcast-listener.test.ts`, `test/integration/investor-bff.integration.test.ts`.

**dashboard-bff** (`services/investor/dashboard-bff`)
- Modify activity-feed/recent-activity ingest: `WITHDRAWAL_COMPLETED` → `WITHDRAWAL_SETTLED` (keep `DEPOSIT_DETECTED`). Update `src/service.stack.ts` ingress + transform + tests.

**dashboard-mfe / advisory-mfe** (`apps/dashboard-mfe`, `apps/advisory-mfe`)
- Modify activity-feed icon map: `WITHDRAWAL_COMPLETED` → `WITHDRAWAL_SETTLED`; update specs.

**e2e** (`apps/e2e-feature-tests`, `apps/nestfolio-e2e`)
- `apps/e2e-feature-tests/src/funding/withdraw-cash.e2e.test.ts` — synthetic event `WITHDRAWAL_COMPLETED` → `WITHDRAWAL_SETTLED`.
- `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts` — `DEPOSIT_DETECTED` injections unchanged (DETECTED still emitted).
- Confirm `fund-account.e2e.test.ts` + deposit specs still pass.

---

# Phase 1 — Event taxonomy & bus contract

Goal: every event-name constant + adapter forwarding + ingress subscription is coherent for the new contract. Compile-checkable; no behavior yet. Do this first so later phases reference stable names.

### Task 1.1: broker-ctrl event names

**Files:**
- Modify: `services/execution/broker-ctrl/src/domain/events.ts`

- [ ] **Step 1: Edit the event constants**

Replace `BrokerCtrlEventTypes` and the relevant `BrokerCtrlInboundEventTypes` entry:

```typescript
export const BrokerCtrlEventTypes = {
  // Order lifecycle (unchanged — still emitted from NormalizedEvent CDC)
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  // Funding lifecycle (NEW — emitted from FundingEvent CDC, carry full snapshot + __version)
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  DEPOSIT_FAILED: eventName('DEPOSIT_FAILED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
  WITHDRAWAL_FAILED: eventName('WITHDRAWAL_FAILED'),
} as const;
```

In `BrokerCtrlInboundEventTypes`, rename the intent it consumes:

```typescript
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_INITIATED: eventName('WITHDRAWAL_INITIATED'),
```

(Leave `SIM_*` / `ALPACA_*` inbound names unchanged.) `BrokerCtrlRoutedEventTypes` is unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm nx typecheck broker-ctrl` (or `pnpm nx build broker-ctrl`)
Expected: errors ONLY in files that reference the old `DEPOSIT_DETECTED` (NormalizedEvent emits), `WITHDRAWAL_COMPLETED`, `TRANSFER_FAILED`, and inbound `WITHDRAWAL_REQUESTED`. These are fixed in later Phase-1/Phase-2 tasks. Note them; do not fix yet.

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-ctrl/src/domain/events.ts
git commit -m "feat(broker-ctrl): funding lifecycle event names + WITHDRAWAL_INITIATED intent"
```

### Task 1.2: investor-bff event names

**Files:**
- Modify: `services/investor/investor-bff/src/domain/events.ts`

- [ ] **Step 1: Edit constants**

In `InvestorBffEventTypes`: rename `WITHDRAWAL_REQUESTED` → `WITHDRAWAL_INITIATED`; remove `DEPOSIT_UPDATED` and `WITHDRAWAL_UPDATED` (the dual-writer modify events go away); add the lifecycle inbound names the BFF will project:

```typescript
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_INITIATED: eventName('WITHDRAWAL_INITIATED'),
  // Funding lifecycle consumed from broker-ctrl (projected to Deposit/WithdrawalRequest P1 rows)
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  DEPOSIT_FAILED: eventName('DEPOSIT_FAILED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
  WITHDRAWAL_FAILED: eventName('WITHDRAWAL_FAILED'),
```

(`DEPOSIT_INITIATED` stays — it is now emitted from the `DepositIntent` outbox row, see Phase 4.)

- [ ] **Step 2: Commit** (typecheck errors expected until Phase 4)

```bash
git add services/investor/investor-bff/src/domain/events.ts
git commit -m "feat(investor-bff): funding lifecycle inbound names + WITHDRAWAL_INITIATED rename"
```

### Task 1.3: cross-domain adapter forwarding

**Files:**
- Modify: `services/ledger/ledger-adpt/src/domain/events.ts` + `src/service.stack.ts`
- Modify: `services/investor/investor-adpt/src/domain/events.ts` + `src/service.stack.ts`
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts` + `src/service.stack.ts` (only if it forwards funding events)

- [ ] **Step 1: ledger-adpt — forward settled events for cash**

In `LedgerIngestEventTypes`: replace `DEPOSIT_DETECTED`/`WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED` with:

```typescript
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
```

(Keep `ORDER_*`, `CORPORATE_ACTION_APPLIED`, `DECISION_PACKET_CREATED`, etc.) Update the adapter's subscription/forwarding rule list in `service.stack.ts` to match. Grep the file for the three removed names and replace.

- [ ] **Step 2: investor-adpt — forward lifecycle to the investor bus**

In `InvestorIngestEventTypes`: replace `DEPOSIT_DETECTED` (single) with the full lifecycle set the BFF projects:

```typescript
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  DEPOSIT_FAILED: eventName('DEPOSIT_FAILED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
  WITHDRAWAL_FAILED: eventName('WITHDRAWAL_FAILED'),
```

Update `service.stack.ts` forwarding rules to subscribe these on the execution bus and republish on the investor bus. Also ensure the **intent** direction: investor-bff emits `DEPOSIT_INITIATED`/`WITHDRAWAL_INITIATED` on the investor bus; whatever adapter carries those to the execution bus must rename `WITHDRAWAL_REQUESTED`→`WITHDRAWAL_INITIATED`. (Grep `investor-adpt` for `WITHDRAWAL_REQUESTED` and `DEPOSIT_INITIATED`.)

- [ ] **Step 3: advisory-adpt — keep `DEPOSIT_DETECTED` if present**

Grep `services/advisory/advisory-adpt/src` for `DEPOSIT_DETECTED`. If it forwards it, leave it (DETECTED is still emitted). No settled forwarding needed for advisory.

- [ ] **Step 4: Typecheck the three adapters**

Run: `pnpm nx run-many -t typecheck -p ledger-adpt,investor-adpt,advisory-adpt`
Expected: clean (these only reference event-name constants).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-adpt services/investor/investor-adpt services/advisory/advisory-adpt
git commit -m "feat(adapters): forward funding lifecycle (*_SETTLED for ledger, full set to investor bus)"
```

---

# Phase 2 — broker-ctrl Funding aggregate (the new owner)

Goal: broker-ctrl writes one carrier row per lifecycle transition, each carrying the full snapshot + status-ordinal `__version`; CDC passthrough emits the semantic events.

### Task 2.1: Funding domain helper

**Files:**
- Create: `services/execution/broker-ctrl/src/domain/funding.ts`
- Test: `services/execution/broker-ctrl/test/unit/funding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/funding.test.ts
import { STATUS_ORDINAL, fundingCarrier } from '../../src/domain/funding';

describe('funding domain', () => {
  it('maps status to monotonic ordinal', () => {
    expect(STATUS_ORDINAL.requested).toBe(1);
    expect(STATUS_ORDINAL.detected).toBe(2);
    expect(STATUS_ORDINAL.settled).toBe(3);
    expect(STATUS_ORDINAL.failed).toBe(3);
  });

  it('builds a DEPOSIT_SETTLED carrier record intent with full snapshot + __version', () => {
    const intent = fundingCarrier({
      eventName: 'DEPOSIT_SETTLED',
      direction: 'DEPOSIT',
      status: 'settled',
      transferId: 'dep-1',
      tenantId: 't-1',
      userId: 'u-1',
      region: 'us-east-1',
      amountCents: 100000,
      currency: 'USD',
      executionMode: 'simulation',
      initiatedAt: '2026-01-01T00:00:00.000Z',
      detectedAt: '2026-01-02T00:00:00.000Z',
      settledAt: '2026-01-03T00:00:00.000Z',
      timestamp: '2026-01-03T00:00:00.000Z',
    });
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'FundingEvent',
      fields: expect.objectContaining({
        __typename: 'FundingEvent',
        sk: 'DEPOSIT_SETTLED',
        direction: 'DEPOSIT',
        status: 'settled',
        transferId: 'dep-1',
        amountCents: 100000,
        settledAt: '2026-01-03T00:00:00.000Z',
        __version: 3,
      }),
      overrides: { pk: 'Funding#t-1#dep-1', sk: 'DEPOSIT_SETTLED' },
    });
  });
});
```

- [ ] **Step 2: Run it red**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/funding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `funding.ts`**

```typescript
import { record, type WriteIntent } from '@nestfolio/event-processor';

export type FundingStatus = 'requested' | 'detected' | 'settled' | 'failed';
export type FundingDirection = 'DEPOSIT' | 'WITHDRAWAL';

export const STATUS_ORDINAL: Record<FundingStatus, number> = {
  requested: 1,
  detected: 2,
  settled: 3,
  failed: 3,
};

export interface FundingSnapshot {
  eventName: string;          // the semantic lifecycle event name (becomes sk + CDC event)
  direction: FundingDirection;
  status: FundingStatus;
  transferId: string;
  tenantId: string;
  userId: string;
  region: string;
  amountCents: number;
  currency: string;
  executionMode: 'simulation' | 'live';
  initiatedAt: string;
  detectedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reason?: string;
  timestamp: string;
}

/**
 * One immutable carrier row per lifecycle transition.
 * pk = Funding#<tenantId>#<transferId>, sk = the lifecycle event name (distinct
 * per transition → clean single-INSERT CDC, no stream coalescing). The row IS the
 * full funding snapshot; CDC `field:'sk', passthrough` re-emits sk as the event,
 * carrying every field. __version is the status ordinal so investor-bff's
 * projectVersioned guard keeps requested<detected<settled ordering.
 */
export function fundingCarrier(s: FundingSnapshot): WriteIntent {
  return record('FundingEvent', {
    __typename: 'FundingEvent',
    sk: s.eventName,
    direction: s.direction,
    status: s.status,
    transferId: s.transferId,
    tenantId: s.tenantId,
    userId: s.userId,
    region: s.region,
    amountCents: s.amountCents,
    currency: s.currency,
    executionMode: s.executionMode,
    initiatedAt: s.initiatedAt,
    ...(s.detectedAt ? { detectedAt: s.detectedAt } : {}),
    ...(s.settledAt ? { settledAt: s.settledAt } : {}),
    ...(s.failedAt ? { failedAt: s.failedAt } : {}),
    ...(s.reason ? { reason: s.reason } : {}),
    __version: STATUS_ORDINAL[s.status],
    timestamp: s.timestamp,
  }, {
    pk: `Funding#${s.tenantId}#${s.transferId}`,
    sk: s.eventName,
  });
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/funding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/src/domain/funding.ts services/execution/broker-ctrl/test/unit/funding.test.ts
git commit -m "feat(broker-ctrl): Funding carrier snapshot + status-ordinal __version helper"
```

### Task 2.2: FundingRepository (carry-forward read)

**Files:**
- Create: `services/execution/broker-ctrl/src/repositories/funding.repository.ts`

Mirror the shape of `ExecutionModeRepository` (a thin `TableRepository` subclass). It needs one read: fetch the `requested` carrier so later transitions carry `initiatedAt` (and amount/currency if the inbound event lacks them).

- [ ] **Step 1: Implement**

```typescript
import { TableRepository } from '@nestfolio/event-processor';

export interface FundingCarrierRow {
  transferId: string;
  amountCents: number;
  currency: string;
  initiatedAt: string;
  userId: string;
}

export class FundingRepository extends TableRepository {
  /** Read the requested carrier (sk = the requested event name) for carry-forward. */
  async getRequested(
    tenantId: string,
    transferId: string,
    requestedEventName: string,
  ): Promise<FundingCarrierRow | undefined> {
    const item = await this.get({
      pk: `Funding#${tenantId}#${transferId}`,
      sk: requestedEventName,
    });
    return item as FundingCarrierRow | undefined;
  }
}
```

> If `TableRepository` has no `get(key)` method, use the same access pattern `ExecutionModeRepository.getMode` uses (check `services/execution/broker-ctrl/src/repositories/execution-mode.repository.ts`) and mirror it exactly. Do not introduce a new DDB client style.

- [ ] **Step 2: Typecheck**

Run: `pnpm nx typecheck broker-ctrl`
Expected: this file compiles (other files may still error pending 2.3/2.4).

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-ctrl/src/repositories/funding.repository.ts
git commit -m "feat(broker-ctrl): FundingRepository carry-forward read"
```

### Task 2.3: Router writes the `requested` carrier

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts`
- Test: `services/execution/broker-ctrl/test/unit/deposit-withdrawal-router.test.ts`

The router currently does a raw `eb.send` then `skip()`. It must ALSO write the requested carrier so CDC emits `DEPOSIT_REQUESTED`/`WITHDRAWAL_REQUESTED`. Keep the routing `eb.send`; change the return from `skip()` to the `fundingCarrier(...)` intent. The engine (createIngestionHandler) executes the returned write intent against the table.

- [ ] **Step 1: Update the unit test**

Replace the two router tests' assertions to expect (a) the routing `eb.send` AND (b) a returned record intent for the requested carrier. Add to the existing `describe('DEPOSIT_INITIATED')`:

```typescript
it('writes a DEPOSIT_REQUESTED carrier (v1) in addition to routing', async () => {
  mockDdbSend.mockResolvedValue({ Item: { mode: 'simulation' } });
  const event = makeSqsEvent(
    fakeSqsRecord(
      BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
      { depositId: 'dep-1', amountCents: 1000, currency: 'USD' },
      { tenantId: 't-1', userId: 'u-1', region: 'us-east-1' },
    ),
  );
  const result = await handler(event);
  expect(result.batchItemFailures).toHaveLength(0);
  // routing still happens
  expect(mockEbSend).toHaveBeenCalledTimes(1);
  // carrier write happens (PutCommand on the broker-ctrl table)
  const putCalls = mockDdbSend.mock.calls.filter((c) => c[0]?._type === 'Put');
  expect(putCalls.length).toBeGreaterThanOrEqual(1);
  const put = putCalls.find((c) => c[0].input?.Item?.sk === 'DEPOSIT_REQUESTED');
  expect(put).toBeDefined();
  expect(put[0].input.Item).toMatchObject({
    __typename: 'FundingEvent', sk: 'DEPOSIT_REQUESTED',
    direction: 'DEPOSIT', status: 'requested', __version: 1,
    transferId: 'dep-1', amountCents: 1000, currency: 'USD',
  });
});
```

Add the symmetric `WITHDRAWAL_INITIATED` → `WITHDRAWAL_REQUESTED` carrier test (transferId from `withdrawalId`, `amountCents` from subject). Update the existing routing tests to use `BrokerCtrlInboundEventTypes.WITHDRAWAL_INITIATED` instead of `WITHDRAWAL_REQUESTED`.

> The router test mocks `@aws-sdk/lib-dynamodb` PutCommand as `{ _type: 'Put', input }` (see existing mock block) — reuse it. If the engine writes via the event-processor executor rather than a direct PutCommand the test must assert on the returned intent instead; in that case change the assertion to inspect `handler`'s effect by spying on the executor. Prefer asserting the returned intent shape: refactor the handler to a pure `routeDeposit` that returns the intent and unit-test `routeDeposit` directly (see Step 3).

- [ ] **Step 2: Run red**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/deposit-withdrawal-router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite the handler so each route function returns a `fundingCarrier` intent after routing:

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createIngestionHandler, requireEnv, logger, getUUID, getTime, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { ExecutionModeRepository } from '../repositories/execution-mode.repository';
import { BrokerCtrlRoutedEventTypes, BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier } from '../domain/funding';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = 'broker-ctrl';

const modeRepo = new ExecutionModeRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

async function emitToEventBridge(detailType: string, subject: Record<string, unknown>, ctx: EventContext) {
  const detail = { id: getUUID(), type: detailType, timestamp: getTime(), subject, context: pickRequestContext(ctx) };
  await eb.send(new PutEventsCommand({
    Entries: [{ EventBusName: BUS_NAME, Source: `${BUS_NAME}@${SERVICE_NAME}`, DetailType: detailType, Detail: JSON.stringify(detail) }],
  }));
}

async function routeDeposit(payload: EventPayload, ctx: EventContext) {
  const subject = payload.subject as Record<string, unknown>;
  const mode = await modeRepo.getMode(ctx.tenantId);
  const executionMode = mode === 'live' ? 'live' : 'simulation';
  const detailType = mode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_DEPOSIT_INITIATED;
  await emitToEventBridge(detailType, { ...subject, direction: 'INCOMING' }, ctx);
  const transferId = (subject.depositId as string) ?? ctx.eventId;
  const now = ctx.timestamp;
  logger.info('Deposit routed', { tenantId: ctx.tenantId, mode, detailType });
  return fundingCarrier({
    eventName: BrokerCtrlEventTypes.DEPOSIT_REQUESTED,
    direction: 'DEPOSIT', status: 'requested', transferId,
    tenantId: ctx.tenantId, userId: (subject.userId as string) ?? ctx.userId, region: ctx.region,
    amountCents: subject.amountCents as number, currency: (subject.currency as string) ?? 'USD',
    executionMode, initiatedAt: now, timestamp: now,
  });
}

async function routeWithdrawal(payload: EventPayload, ctx: EventContext) {
  const subject = payload.subject as Record<string, unknown>;
  const mode = await modeRepo.getMode(ctx.tenantId);
  const executionMode = mode === 'live' ? 'live' : 'simulation';
  const detailType = mode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_WITHDRAWAL_REQUESTED;
  await emitToEventBridge(detailType, { ...subject, direction: 'OUTGOING' }, ctx);
  const transferId = (subject.withdrawalId as string) ?? ctx.eventId;
  const now = ctx.timestamp;
  logger.info('Withdrawal routed', { tenantId: ctx.tenantId, mode, detailType });
  return fundingCarrier({
    eventName: BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED,
    direction: 'WITHDRAWAL', status: 'requested', transferId,
    tenantId: ctx.tenantId, userId: (subject.userId as string) ?? ctx.userId, region: ctx.region,
    amountCents: subject.amountCents as number, currency: (subject.currency as string) ?? 'USD',
    executionMode, initiatedAt: now, timestamp: now,
  });
}

export const handler = createIngestionHandler({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED]: routeDeposit,
    [BrokerCtrlInboundEventTypes.WITHDRAWAL_INITIATED]: routeWithdrawal,
  },
});
```

> Note `amountCents` for withdrawal: the `WithdrawalInput` carries `amountCents` (see schema), and the renamed `WithdrawalIntent` outbox row (Phase 4) writes `amountCents`. The old resolver used `amount` for sim — Phase 4 standardizes everything on `amountCents`.

- [ ] **Step 4: Run green**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/deposit-withdrawal-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts services/execution/broker-ctrl/test/unit/deposit-withdrawal-router.test.ts
git commit -m "feat(broker-ctrl): router writes requested funding carrier (v1) + routes"
```

### Task 2.4: Normalizer writes detected/settled/failed carriers

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts`
- Test: `services/execution/broker-ctrl/test/unit/deposit-withdrawal-normalizer.test.ts`

Each completion event reads the requested carrier (for `initiatedAt`) then returns carrier intent(s). Deposit completion returns **two** intents (detected v2, settled v3); withdrawal completion returns one (settled v3); failure returns one (failed v3). A handler may return `WriteIntent[]`.

- [ ] **Step 1: Rewrite the unit test**

The current test asserts `NormalizedEvent` with `sk=DEPOSIT_DETECTED`. Rewrite to assert `FundingEvent` carriers. Because the handler now reads the requested carrier, mock the repository. Convert the test to construct the handler with an injected `FundingRepository` stub. Add `createNormalizerHandlers(repo)` to the source (mirroring ledger-ctrl's `createHandlers(deps)`), and unit-test the pure handler functions:

```typescript
import { createNormalizerHandlers } from '../../src/handlers/deposit-withdrawal-normalizer';
import { BrokerCtrlInboundEventTypes } from '../../src/domain/events';

const requested = {
  transferId: 'dep-1', amountCents: 100000, currency: 'USD',
  initiatedAt: '2026-01-01T00:00:00.000Z', userId: 'u-1',
};
const repo = { getRequested: jest.fn().mockResolvedValue(requested) } as any;
const handlers = createNormalizerHandlers(repo);

const ctx = (over = {}) => ({
  eventId: 'evt-1', eventType: 'SIM_DEPOSIT_COMPLETED', tenantId: 't-1', userId: 'u-1',
  region: 'us-east-1', timestamp: '2026-01-03T00:00:00.000Z', ...over,
}) as any;

it('SIM_DEPOSIT_COMPLETED → [DEPOSIT_DETECTED v2, DEPOSIT_SETTLED v3] carriers', async () => {
  const out = await handlers[BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED](
    { subject: { depositId: 'dep-1', amountCents: 100000, currency: 'USD' } } as any,
    ctx(),
  );
  const intents = Array.isArray(out) ? out : [out];
  expect(intents.map((i) => i.overrides.sk)).toEqual(['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
  expect(intents[0].fields).toMatchObject({ status: 'detected', __version: 2, detectedAt: '2026-01-03T00:00:00.000Z', initiatedAt: requested.initiatedAt });
  expect(intents[1].fields).toMatchObject({ status: 'settled', __version: 3, settledAt: '2026-01-03T00:00:00.000Z', initiatedAt: requested.initiatedAt, detectedAt: '2026-01-03T00:00:00.000Z' });
});

it('SIM_WITHDRAWAL_COMPLETED → [WITHDRAWAL_SETTLED v3] carrier with amountCents + settledAt', async () => {
  repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-1' });
  const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
    { subject: { withdrawalId: 'wd-1', amountCents: 50000, currency: 'USD' } } as any,
    ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
  );
  const intents = Array.isArray(out) ? out : [out];
  expect(intents).toHaveLength(1);
  expect(intents[0].overrides.sk).toBe('WITHDRAWAL_SETTLED');
  expect(intents[0].fields).toMatchObject({ direction: 'WITHDRAWAL', status: 'settled', __version: 3, amountCents: 50000, settledAt: '2026-01-03T00:00:00.000Z' });
});

it('ALPACA_TRANSFER_FAILED → [DEPOSIT_FAILED v3] carrier with reason', async () => {
  repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'xfr-1' });
  const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
    { subject: { transferId: 'xfr-1', amountCents: 25000, direction: 'INCOMING', failureReason: 'bank declined' } } as any,
    ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
  );
  const intents = Array.isArray(out) ? out : [out];
  expect(intents[0].overrides.sk).toBe('DEPOSIT_FAILED');
  expect(intents[0].fields).toMatchObject({ status: 'failed', __version: 3, reason: 'bank declined', failedAt: '2026-01-03T00:00:00.000Z' });
});
```

- [ ] **Step 2: Run red**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/deposit-withdrawal-normalizer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { requireEnv, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { createIngestionHandler } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier, type FundingDirection } from '../domain/funding';
import { FundingRepository } from '../repositories/funding.repository';

type Deps = { getRequested: FundingRepository['getRequested'] };

async function carryForward(
  deps: Deps, tenantId: string, transferId: string, requestedEventName: string,
  fallback: { amountCents: number; currency: string; userId: string; initiatedAt: string },
) {
  const req = await deps.getRequested(tenantId, transferId, requestedEventName);
  return {
    amountCents: req?.amountCents ?? fallback.amountCents,
    currency: req?.currency ?? fallback.currency,
    userId: req?.userId ?? fallback.userId,
    initiatedAt: req?.initiatedAt ?? fallback.initiatedAt,
  };
}

function depositCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext) => {
    const s = payload.subject as Record<string, unknown>;
    const transferId = (s.depositId as string) ?? ctx.eventId;
    const cf = await carryForward(deps, ctx.tenantId, transferId, BrokerCtrlEventTypes.DEPOSIT_REQUESTED, {
      amountCents: s.amountCents as number, currency: (s.currency as string) ?? 'USD',
      userId: (s.userId as string) ?? ctx.userId, initiatedAt: ctx.timestamp,
    });
    const executionMode = ctx.eventType === BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED ? 'simulation' : 'live';
    const base = {
      direction: 'DEPOSIT' as FundingDirection, transferId, tenantId: ctx.tenantId,
      userId: cf.userId, region: ctx.region, amountCents: cf.amountCents, currency: cf.currency,
      executionMode, initiatedAt: cf.initiatedAt, detectedAt: ctx.timestamp, timestamp: ctx.timestamp,
    } as const;
    return [
      fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_DETECTED, status: 'detected' }),
      fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_SETTLED, status: 'settled', settledAt: ctx.timestamp }),
    ];
  };
}

function withdrawalCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext) => {
    const s = payload.subject as Record<string, unknown>;
    const transferId = (s.withdrawalId as string) ?? ctx.eventId;
    const cf = await carryForward(deps, ctx.tenantId, transferId, BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED, {
      amountCents: s.amountCents as number, currency: (s.currency as string) ?? 'USD',
      userId: (s.userId as string) ?? ctx.userId, initiatedAt: ctx.timestamp,
    });
    const executionMode = ctx.eventType === BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED ? 'simulation' : 'live';
    return fundingCarrier({
      eventName: BrokerCtrlEventTypes.WITHDRAWAL_SETTLED, direction: 'WITHDRAWAL', status: 'settled',
      transferId, tenantId: ctx.tenantId, userId: cf.userId, region: ctx.region,
      amountCents: cf.amountCents, currency: cf.currency, executionMode,
      initiatedAt: cf.initiatedAt, settledAt: ctx.timestamp, timestamp: ctx.timestamp,
    });
  };
}

function alpacaCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext) => {
    const s = payload.subject as Record<string, unknown>;
    const isDeposit = s.direction === 'INCOMING';
    return isDeposit ? depositCompletion(deps)(payload, ctx) : withdrawalCompletion(deps)(payload, ctx);
  };
}

function transferFailed(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext) => {
    const s = payload.subject as Record<string, unknown>;
    const isDeposit = s.direction === 'INCOMING';
    const transferId = (s.transferId as string) ?? ctx.eventId;
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, transferId, requestedName, {
      amountCents: s.amountCents as number, currency: (s.currency as string) ?? 'USD',
      userId: (s.userId as string) ?? ctx.userId, initiatedAt: ctx.timestamp,
    });
    return fundingCarrier({
      eventName: isDeposit ? BrokerCtrlEventTypes.DEPOSIT_FAILED : BrokerCtrlEventTypes.WITHDRAWAL_FAILED,
      direction: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL', status: 'failed', transferId,
      tenantId: ctx.tenantId, userId: cf.userId, region: ctx.region,
      amountCents: cf.amountCents, currency: cf.currency, executionMode: 'live',
      initiatedAt: cf.initiatedAt, failedAt: ctx.timestamp,
      reason: (s.failureReason as string) ?? 'Transfer failed', timestamp: ctx.timestamp,
    });
  };
}

export function createNormalizerHandlers(repo: Pick<FundingRepository, 'getRequested'>) {
  const deps: Deps = { getRequested: repo.getRequested.bind(repo) };
  return {
    [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: depositCompletion(deps),
    [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: withdrawalCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: alpacaCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: transferFailed(deps),
  };
}

const repo = new FundingRepository(requireEnv('TABLE_NAME'));

export const handler = createIngestionHandler({
  serviceName: 'broker-ctrl',
  handlers: createNormalizerHandlers(repo),
});
```

> If the engine requires `materializeToTable` (not `createIngestionHandler`) to execute returned intents against the table, switch the production export to `materializeToTable({ serviceName, handlers: createNormalizerHandlers(repo) })` — confirm against how `mode-listener.ts` (materializeToTable, returns record) vs `callback-resolver.ts` (createIngestionHandler, returns skip) behave. The rule: **a handler that returns a write intent to be persisted must run under `materializeToTable`.** The router (2.3) also persists a carrier, so it likewise must use `materializeToTable`. Update both exports accordingly and re-run their unit tests.

- [ ] **Step 4: Run green**

Run: `pnpm nx test broker-ctrl --testFile=test/unit/deposit-withdrawal-normalizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts services/execution/broker-ctrl/test/unit/deposit-withdrawal-normalizer.test.ts
git commit -m "feat(broker-ctrl): normalizer writes detected/settled/failed funding carriers"
```

### Task 2.5: Egress + ingress wiring + CDK test

**Files:**
- Modify: `services/execution/broker-ctrl/src/service.stack.ts`
- Test: `services/execution/broker-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Update the stack**

(a) Egress — split funding off `NormalizedEvent` onto a new `FundingEvent` passthrough; remove the funding names from `NormalizedEvent` emits:

```typescript
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'NormalizedEvent': {
      insert: { field: 'sk', passthrough: true, emits: [
        BrokerCtrlEventTypes.ORDER_FILLED,
        BrokerCtrlEventTypes.ORDER_PARTIALLY_FILLED,
        BrokerCtrlEventTypes.ORDER_REJECTED,
        BrokerCtrlEventTypes.ORDER_CANCELLED,
        BrokerCtrlEventTypes.ORDER_ESCALATED,
      ]},
    },
    'FundingEvent': {
      insert: { field: 'sk', passthrough: true, emits: [
        BrokerCtrlEventTypes.DEPOSIT_REQUESTED,
        BrokerCtrlEventTypes.DEPOSIT_DETECTED,
        BrokerCtrlEventTypes.DEPOSIT_SETTLED,
        BrokerCtrlEventTypes.DEPOSIT_FAILED,
        BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED,
        BrokerCtrlEventTypes.WITHDRAWAL_SETTLED,
        BrokerCtrlEventTypes.WITHDRAWAL_FAILED,
      ]},
    },
  },
});
```

(b) Ingress rename — the deposit/withdrawal router ingress subscribes the renamed intent:

```typescript
const depositWithdrawalIngress = new Ingress(this, 'DepositWithdrawalIngress', {
  state,
  eventTypes: [
    BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
    BrokerCtrlInboundEventTypes.WITHDRAWAL_INITIATED,
  ],
  entry: join(__dirname, 'handlers', 'deposit-withdrawal-router.ts'),
});
```

(c) Grant table read to both handlers so they can read the requested carrier / write carriers. The `Ingress` construct already grants its handler RW on the table when the handler is materializeToTable-backed; confirm by checking how `mode-listener` ingress is wired. If reads need an explicit grant, add `state.getTable().grantReadData(...)` for the normalizer/router handlers (or rely on the construct's default RW). No extra env needed beyond `TABLE_NAME` (already injected by Ingress).

- [ ] **Step 2: Update the CDK test**

In `test/unit/service.stack.test.ts`: change the "deposit/withdrawal inbound events" assertion from `WITHDRAWAL_REQUESTED` to `WITHDRAWAL_INITIATED`; add an assertion that an EB rule exists for none of the funding lifecycle (they are egress, not ingress). Add a test asserting the egress publisher is configured for both `NormalizedEvent` and `FundingEvent` — assert via the CDC filter or the publisher env. Minimal robust assertion:

```typescript
it('subscribes the renamed WITHDRAWAL_INITIATED intent (not WITHDRAWAL_REQUESTED)', () => {
  const rules = template.findResources('AWS::Events::Rule');
  const detailTypes = Object.values(rules).flatMap((r: any) => r.Properties?.EventPattern?.['detail-type'] ?? []);
  expect(detailTypes).toContain('DEPOSIT_INITIATED');
  expect(detailTypes).toContain('WITHDRAWAL_INITIATED');
  expect(detailTypes).not.toContain('WITHDRAWAL_REQUESTED');
});
```

- [ ] **Step 3: Run unit suite + typecheck**

Run: `pnpm nx test broker-ctrl` then `pnpm nx typecheck broker-ctrl`
Expected: all broker-ctrl unit tests green; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-ctrl/src/service.stack.ts services/execution/broker-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(broker-ctrl): FundingEvent CDC egress + WITHDRAWAL_INITIATED ingress"
```

---

# Phase 3 — ledger-ctrl: cash on settlement

### Task 3.1: account.reducer settled cases

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/account.reducer.ts`
- Test: `services/ledger/ledger-ctrl/test/unit/domain/account.reducer.test.ts`

- [ ] **Step 1: Update the unit test**

Rename the two cases and fix the withdrawal field shape (now `amountCents` + `settledAt`):

```typescript
it('applies DEPOSIT_SETTLED', () => {
  const next = accountReducer(INITIAL_ACCOUNT_STATE, {
    eventId: 'e1', eventType: 'DEPOSIT_SETTLED', sequenceNo: 1,
    timestamp: '2026-03-12T00:00:00Z',
    payload: { depositId: 'd1', amountCents: 500_00, settledAt: '2026-03-12T00:00:00Z' },
  });
  expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00);
});

it('applies WITHDRAWAL_SETTLED', () => {
  const next = accountReducer(INITIAL_ACCOUNT_STATE, {
    eventId: 'e2', eventType: 'WITHDRAWAL_SETTLED', sequenceNo: 1,
    timestamp: '2026-03-12T00:00:00Z',
    payload: { withdrawalId: 'w1', amountCents: 200_00, settledAt: '2026-03-12T00:00:00Z' },
  });
  expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 200_00);
});

it('ignores DEPOSIT_DETECTED (no cash effect)', () => {
  const next = accountReducer(INITIAL_ACCOUNT_STATE, {
    eventId: 'e3', eventType: 'DEPOSIT_DETECTED', sequenceNo: 1,
    timestamp: '2026-03-12T00:00:00Z',
    payload: { depositId: 'd1', amountCents: 500_00, detectedAt: '2026-03-12T00:00:00Z' },
  });
  expect(next).toEqual(INITIAL_ACCOUNT_STATE);
});
```

- [ ] **Step 2: Run red**

Run: `pnpm nx test ledger-ctrl --testFile=test/unit/domain/account.reducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `account.reducer.ts` change the two case labels and the withdrawal field reads:

```typescript
    case 'DEPOSIT_SETTLED': {
      const result = applyCommand(RecordDeposit, {
        depositId: p['depositId'] as string,
        amountCents: p['amountCents'] as number,
        depositedAt: p['settledAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'WITHDRAWAL_SETTLED': {
      const result = applyCommand(RecordWithdrawal, {
        withdrawalId: p['withdrawalId'] as string,
        amountCents: p['amountCents'] as number,
        withdrawnAt: p['settledAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
```

(`DEPOSIT_DETECTED`/`WITHDRAWAL_COMPLETED` cases are removed; they fall through to `default: return state`.)

- [ ] **Step 4: Run green**

Run: `pnpm nx test ledger-ctrl --testFile=test/unit/domain/account.reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/account.reducer.ts services/ledger/ledger-ctrl/test/unit/domain/account.reducer.test.ts
git commit -m "fix(ledger-ctrl): apply cash on *_SETTLED with settledAt (fixes settlement-never-persisted)"
```

### Task 3.2: ledger-ctrl ingress subscription

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update `ACTUAL_EVENT_TYPES`**

In `event-listener.ts`, replace the deposit/withdrawal entries:

```typescript
const ACTUAL_EVENT_TYPES = [
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_PARTIALLY_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
  ExecutionCrossDomainEventTypes.DEPOSIT_SETTLED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_SETTLED,
  ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
] as const;
```

(Add `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED` to `ExecutionCrossDomainEventTypes` in `services/execution/execution-adpt/src/domain/events.ts`; remove `DEPOSIT_DETECTED`/`WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED` there if unused elsewhere — grep first.)

- [ ] **Step 2: Update `service.stack.ts` Ingress eventTypes**

Replace `LedgerIngestEventTypes.DEPOSIT_DETECTED`/`.WITHDRAWAL_COMPLETED` with `.DEPOSIT_SETTLED`/`.WITHDRAWAL_SETTLED` (these were added to `ledger-adpt` in Task 1.3).

- [ ] **Step 3: Typecheck + unit**

Run: `pnpm nx typecheck ledger-ctrl && pnpm nx test ledger-ctrl`
Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/src services/execution/execution-adpt/src/domain/events.ts
git commit -m "feat(ledger-ctrl): subscribe DEPOSIT_SETTLED/WITHDRAWAL_SETTLED for cash"
```

---

# Phase 4 — investor-bff: projections, intent outbox, retire dual-writer

### Task 4.1: ownership registry

**Files:**
- Modify: `services/investor/investor-bff/src/read-model-ownership.ts`

- [ ] **Step 1: Edit**

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    CashBalance: Projection<'P1'>;
    InvestorProfile: CommandOwned;
    Mandate: CommandOwned;
    Notification: CommandOwned;
    // w5 — externally-settled funding entities
    Deposit: Projection<'P1'>;
    WithdrawalRequest: Projection<'P1'>;
    // w5 — local intent outbox rows (command-owned, CDC-emit the intent)
    DepositIntent: CommandOwned;
    WithdrawalIntent: CommandOwned;
  }
}
```

Update the `import type` line to include `CommandOwned` (already imported) and `Projection` (already imported). Remove the "NOT registered" comment lines for Deposit/Withdrawal.

- [ ] **Step 2: Typecheck**

Run: `pnpm nx typecheck investor-bff`
Expected: errors now appear in `initiate-deposit`/`request-withdrawal` (still writing `Deposit`/`Withdrawal` via plain put — but those are JS resolvers, not TS intents, so no typecheck error there) and any TS that calls `record`/`project` on `Deposit`. Note them; fixed below.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/read-model-ownership.ts
git commit -m "feat(investor-bff): register Deposit/WithdrawalRequest P1 + intent outbox ownership"
```

### Task 4.2: projection transforms

**Files:**
- Create: `services/investor/investor-bff/src/transforms/deposit-lifecycle.ts`
- Create: `services/investor/investor-bff/src/transforms/withdrawal-lifecycle.ts`
- Test: `services/investor/investor-bff/test/unit/transforms/deposit-lifecycle.test.ts`, `…/withdrawal-lifecycle.test.ts`

The lifecycle events carry the full funding snapshot + `__version`. Project verbatim into the read-row, mapping `status` (`requested|detected|settled|failed`) to the GraphQL string and mapping timestamps to the `Deposit`/`WithdrawalRequest` shape.

- [ ] **Step 1: Write failing tests** (deposit shown; mirror for withdrawal)

```typescript
// test/unit/transforms/deposit-lifecycle.test.ts
import { projectVersioned } from '@nestfolio/event-processor';
import { depositLifecycle } from '../../../src/transforms/deposit-lifecycle';

const uow = (subject: Record<string, unknown>) => ({
  event: { id: 'e1', type: subject.sk as string, timestamp: '2026-01-03T00:00:00.000Z',
    subject, context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' } },
  payload: {}, record: {},
});

it('projects DEPOSIT_SETTLED into a versioned Deposit P1 row', () => {
  const out = depositLifecycle(uow({
    sk: 'DEPOSIT_SETTLED', status: 'settled', transferId: 'dep-1', amountCents: 100000,
    currency: 'USD', initiatedAt: '2026-01-01T00:00:00.000Z', detectedAt: '2026-01-02T00:00:00.000Z',
    settledAt: '2026-01-03T00:00:00.000Z', __version: 3,
  }) as Parameters<typeof depositLifecycle>[0]);
  expect(out).toEqual(projectVersioned('Deposit', {
    tenantId: 't1', userId: 'u1', region: 'us-east-1', depositId: 'dep-1',
    amountCents: 100000, currency: 'USD', status: 'SETTLED',
    initiatedAt: '2026-01-01T00:00:00.000Z', detectedAt: '2026-01-02T00:00:00.000Z',
    settledAt: '2026-01-03T00:00:00.000Z', failedAt: null, reason: null,
  }, {
    version: 3,
    overrides: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1' },
  }));
});
```

- [ ] **Step 2: Run red**

Run: `pnpm nx test investor-bff --testFile=test/unit/transforms/deposit-lifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `deposit-lifecycle.ts`**

```typescript
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface FundingSubject {
  status: 'requested' | 'detected' | 'settled' | 'failed';
  transferId: string;
  amountCents: number;
  currency: string;
  initiatedAt: string;
  detectedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reason?: string;
  __version: number;
}

export const depositLifecycle = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { tenantId, userId, region } = uow.event.context;
  const s = uow.event.subject as unknown as FundingSubject;
  return projectVersioned('Deposit', {
    tenantId, userId, region,
    depositId: s.transferId,
    amountCents: s.amountCents,
    currency: s.currency,
    status: s.status.toUpperCase(),
    initiatedAt: s.initiatedAt,
    detectedAt: s.detectedAt ?? null,
    settledAt: s.settledAt ?? null,
    failedAt: s.failedAt ?? null,
    reason: s.reason ?? null,
  }, {
    version: Number(s.__version),
    overrides: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${s.transferId}` },
  });
};
```

`withdrawal-lifecycle.ts` is identical except `projectVersioned('WithdrawalRequest', { …, withdrawalId: s.transferId, requestedAt: s.initiatedAt, settledAt, failedAt, reason }, { … sk: \`Withdrawal#${s.transferId}\` })`. Match the `WithdrawalRequest` GraphQL fields (Task 4.6 adds `settledAt`/`failedAt`/`reason`/`status` if missing).

- [ ] **Step 4: Run green** (both transform tests)

Run: `pnpm nx test investor-bff --testFile=test/unit/transforms/deposit-lifecycle.test.ts` and the withdrawal one.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/transforms/deposit-lifecycle.ts services/investor/investor-bff/src/transforms/withdrawal-lifecycle.ts services/investor/investor-bff/test/unit/transforms
git commit -m "feat(investor-bff): deposit/withdrawal lifecycle P1 projection transforms"
```

### Task 4.3: register transforms + projection ingress

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Register the transforms**

In `event-listener.ts` `createHandlers`, add (and the `import '../read-model-ownership';` side-effect import at top if not present):

```typescript
    [InvestorBffEventTypes.DEPOSIT_REQUESTED]: (p, c) => depositLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.DEPOSIT_DETECTED]: (p, c) => depositLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.DEPOSIT_SETTLED]: (p, c) => depositLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.DEPOSIT_FAILED]: (p, c) => depositLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.WITHDRAWAL_REQUESTED]: (p, c) => withdrawalLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.WITHDRAWAL_SETTLED]: (p, c) => withdrawalLifecycle(toUow(p, c)),
    [InvestorBffEventTypes.WITHDRAWAL_FAILED]: (p, c) => withdrawalLifecycle(toUow(p, c)),
```

Import both transforms. (Types: use the same `(payload: EventPayload, ctx: EventContext)` signature as the existing entries.)

- [ ] **Step 2: Add the events to the main Ingress**

In `service.stack.ts`, add the seven lifecycle names to the main `Ingress` `eventTypes` array (the one feeding `event-listener.ts`). They arrive on the investor bus via investor-adpt (Task 1.3):

```typescript
        InvestorBffEventTypes.DEPOSIT_REQUESTED,
        InvestorBffEventTypes.DEPOSIT_DETECTED,
        InvestorBffEventTypes.DEPOSIT_SETTLED,
        InvestorBffEventTypes.DEPOSIT_FAILED,
        InvestorBffEventTypes.WITHDRAWAL_REQUESTED,
        InvestorBffEventTypes.WITHDRAWAL_SETTLED,
        InvestorBffEventTypes.WITHDRAWAL_FAILED,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm nx typecheck investor-bff`
Expected: clean (transforms registered, ownership satisfied).

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/src/handlers/event-listener.ts services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): ingest + project funding lifecycle events"
```

### Task 4.4: intent outbox resolvers

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js`
- Modify: `services/investor/investor-bff/src/graphql/js-function/request-withdrawal.fn.js`

- [ ] **Step 1: initiate-deposit → DepositIntent outbox**

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const depositId = input.depositId;
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!depositId) util.error('depositId required', 'ValidationError');
  if (!util.matches('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$', depositId))
    util.error('depositId must be UUID v4', 'ValidationError');
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const now = util.time.nowISO8601();
  // Optimistic return — the authoritative Deposit row is a P1 projection fed by
  // broker-ctrl lifecycle events; the client shows INITIATED optimistically.
  ctx.stash._depositResult = { depositId, amountCents, currency, status: 'INITIATED', initiatedAt: now };
  return ddb.put({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `DepositIntent#${depositId}` },
    item: {
      __typename: 'DepositIntent', tenantId, userId, region: ctx.stash.region,
      depositId, amountCents, currency, initiatedAt: now, timestamp: now,
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._depositResult;
}
```

- [ ] **Step 2: request-withdrawal → read-only balance check + WithdrawalIntent outbox**

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const withdrawalId = util.autoId();
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._withdrawalResult = { withdrawalId, amountCents, currency, status: 'REQUESTED', requestedAt: now };
  // D7: read-only precondition on the ledger-owned CashBalance projection (NO debit),
  // plus the WithdrawalIntent outbox write. Cash is debited once, in ledger, on settlement.
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName,
        operation: 'ConditionCheck',
        key: util.dynamodb.toMapValues({ pk, sk: 'CashBalance' }),
        condition: {
          expression: 'attribute_exists(pk) AND cashBalanceCents >= :amount',
          expressionValues: util.dynamodb.toMapValues({ ':amount': amountCents }),
        },
      },
      {
        table: ctx.stash.tableName,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `WithdrawalIntent#${withdrawalId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'WithdrawalIntent', tenantId, userId, region: ctx.stash.region,
          withdrawalId, amountCents, currency, requestedAt: now, timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:TransactionCanceledException') {
      util.error('Insufficient funds', 'InsufficientFundsError');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.stash._withdrawalResult;
}
```

- [ ] **Step 3: Commit** (resolvers are validated by integration tests in 4.7)

```bash
git add services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js services/investor/investor-bff/src/graphql/js-function/request-withdrawal.fn.js
git commit -m "feat(investor-bff): deposit/withdrawal intents write outbox rows (no projected-row write, no cash debit)"
```

### Task 4.5: egress remap (intent rows emit intents; remove dual-writer rows)

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Replace the `Deposit`/`Withdrawal` egress with intent-row egress**

```typescript
        'DepositIntent': { insert: InvestorBffEventTypes.DEPOSIT_INITIATED },
        'WithdrawalIntent': { insert: InvestorBffEventTypes.WITHDRAWAL_INITIATED },
```

Remove the old `'Deposit': { insert: DEPOSIT_INITIATED, modify: DEPOSIT_UPDATED }` and `'Withdrawal': { insert: WITHDRAWAL_REQUESTED, modify: WITHDRAWAL_UPDATED }` entries — the `Deposit`/`WithdrawalRequest` rows are now projections (written by projectVersioned, which must NOT re-emit CDC intents; they are not in the egress map).

- [ ] **Step 2: Typecheck + CDK test if present**

Run: `pnpm nx test investor-bff`
Expected: green (update any service.stack CDK test that asserted `Deposit`/`Withdrawal` egress to assert `DepositIntent`/`WithdrawalIntent` instead).

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): egress emits intents from outbox rows; drop dual-writer Deposit/Withdrawal egress"
```

### Task 4.6: retire dual-writer + schema cleanup + onboarding seed

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/broadcast-listener.ts`
- Delete: `services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js`
- Modify: `services/investor/investor-bff/src/schema.graphql`
- Modify: `services/investor/investor-bff/src/service.stack.ts` (broadcast ingress drop `DEPOSIT_DETECTED`)
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
- Test: `services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts`

- [ ] **Step 1: broadcast-listener — drop the deposit broadcast**

Remove the `[InvestorIngestEventTypes.DEPOSIT_DETECTED]` broadcast entry and the `PUBLISH_DEPOSIT_EVENT` constant + its import usage. Keep the circuit-breaker broadcasts. Update `broadcast-listener.test.ts`: delete the "on DEPOSIT_DETECTED fires publishDepositEvent" test; keep the circuit tests; add an assertion that a `DEPOSIT_DETECTED` event is now a no-op (skipped).

- [ ] **Step 2: schema.graphql cleanup**

Remove `publishDepositEvent` mutation, the `DepositEvent` type, `DepositEventInput`, `DepositStatus` enum, and the `onDepositEvent` subscription. Add `settledAt`/`failedAt`/`reason`/`status` fields to `WithdrawalRequest` to match the projection:

```graphql
type WithdrawalRequest {
  withdrawalId: ID!
  amountCents: Int!
  currency: String!
  status: String!
  requestedAt: String!
  settledAt: String
  failedAt: String
  reason: String
}
```

Add `settledAt: String` to `Deposit` (it already has `detectedAt`/`failedAt`/`reason`).

- [ ] **Step 3: Remove broadcast ingress DEPOSIT_DETECTED subscription**

In `service.stack.ts`, the `BroadcastIngress` `eventTypes` drops `InvestorIngestEventTypes.DEPOSIT_DETECTED` (keep circuit events). Also remove the now-unused `discoverJsResolvers` reference to `publish-deposit-event` if any (it auto-discovers; deleting the file is enough).

- [ ] **Step 4: onboarding-completed — seed an intent, not a Deposit row**

In `onboarding-completed.ts`, change the conditional `Deposit#${depositId}` Put to a `DepositIntent#${depositId}` Put so the onboarding-originated deposit flows the single-owner path:

```typescript
      ...(s.capitalAmount > 0
        ? [
            {
              Put: {
                TableName: tableName,
                Item: {
                  pk,
                  sk: `DepositIntent#${depositId}`,
                  __typename: 'DepositIntent',
                  tenantId: s.tenantId, userId: s.userId, region: ctx.region,
                  depositId, amountCents: s.capitalAmount, currency: s.currency,
                  initiatedAt: now, timestamp: now,
                } satisfies TableEntry,
              },
            },
          ]
        : []),
```

- [ ] **Step 5: Run unit suite**

Run: `pnpm nx test investor-bff`
Expected: green (broadcast test updated; transform/onboarding compile).

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src
git rm services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js
git commit -m "refactor(investor-bff): retire deposit dual-writer; onboarding seeds DepositIntent; schema cleanup"
```

### Task 4.7: investor-bff integration tests

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Rewrite the deposit/withdrawal integration assertions**

Replace the old "initiateDeposit → DEPOSIT_INITIATED + Deposit row INITIATED" and the deposit-subscription test with the new contract:

(a) `initiateDeposit` writes a `DepositIntent` row and CDC emits `DEPOSIT_INITIATED` (trap on investor bus).
(b) Emitting the lifecycle events (`DEPOSIT_REQUESTED` v1 → `DEPOSIT_DETECTED` v2 → `DEPOSIT_SETTLED` v3) onto the investor bus materializes the `Deposit#<id>` row with the right status and a monotonic `__version`; a stale (lower-version) event does not regress it. Mirror the ledger-bff version-guard integration pattern (emit v=1, v=2, v=3; assert `__version` and `status`).
(c) `requestWithdrawal` with sufficient funds writes a `WithdrawalIntent` row + emits `WITHDRAWAL_INITIATED`; with insufficient funds the mutation errors `InsufficientFundsError` and writes NO intent row.

Use the existing harness imports (`CognitoFixture`, `AppSyncClient`, `EventBridgeClient`, `EventBusTrap`, `TableAssertions`). For (c) insufficient-funds, do not pre-seed CashBalance (or seed it below the amount) and assert the GraphQL error.

- [ ] **Step 2: Commit** (run in the validation gate, Phase 6)

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): integration for intent outbox + versioned funding projections"
```

---

# Phase 5 — dashboard activity rename

### Task 5.1: dashboard-bff WITHDRAWAL_COMPLETED → WITHDRAWAL_SETTLED

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts` (or wherever recent-activity ingests), `src/service.stack.ts`, the recent-activity transform, and its unit tests.

- [ ] **Step 1: Grep + replace**

Run: `pnpm nx run dashboard-bff:lint` after replacing every `WITHDRAWAL_COMPLETED` with `WITHDRAWAL_SETTLED` in dashboard-bff src (keep `DEPOSIT_DETECTED`). Update the ingress event-types + the activity transform's switch/case + its unit test fixtures.

- [ ] **Step 2: Run unit**

Run: `pnpm nx test dashboard-bff`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add services/investor/dashboard-bff/src services/investor/dashboard-bff/test
git commit -m "feat(dashboard-bff): activity feed consumes WITHDRAWAL_SETTLED"
```

### Task 5.2: MFE icon maps

**Files:**
- Modify: `apps/dashboard-mfe/src/app/dashboard/activity-feed.component.ts` + spec; `apps/advisory-mfe` decision-list spec if it references `WITHDRAWAL_COMPLETED`.

- [ ] **Step 1: Replace the icon-map key**

`WITHDRAWAL_COMPLETED: 'pi pi-arrow-up'` → `WITHDRAWAL_SETTLED: 'pi pi-arrow-up'`. Update the matching `.spec.ts` expectations.

- [ ] **Step 2: Run**

Run: `pnpm nx test dashboard-mfe` (and advisory-mfe if touched)
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard-mfe apps/advisory-mfe
git commit -m "feat(mfe): activity icon map uses WITHDRAWAL_SETTLED"
```

---

# Phase 6 — e2e fixtures + validation gate

### Task 6.1: e2e fixture/scenario updates

**Files:**
- Modify: `apps/e2e-feature-tests/src/funding/withdraw-cash.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/funding/fund-account.e2e.test.ts`, `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts`, deposit specs.

- [ ] **Step 1: withdraw-cash synthetic event**

Change the synthetic EB emission `detailType: 'WITHDRAWAL_COMPLETED'` → `'WITHDRAWAL_SETTLED'` and ensure the detail subject carries `amountCents` + `settledAt` (matching the new ledger contract). Keep the activity-feed assertion (`activityType.includes('WITHDRAWAL')`).

- [ ] **Step 2: Confirm deposit injections**

`inject-advisory-update.ts` injects `DEPOSIT_DETECTED` — still valid (DETECTED is still emitted). No change. `fund-account.e2e.test.ts` uses `initiateDeposit` + activity polling — still valid. Confirm by reading; change only if an assertion depends on the removed `publishDepositEvent`/`onDepositEvent` subscription.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests apps/nestfolio-e2e
git commit -m "test(e2e): withdraw-cash emits WITHDRAWAL_SETTLED"
```

### Task 6.2: Validation gate — affected, deploy, integration, scoped e2e

- [ ] **Step 1: nx affected test + lint (must pass before deploy)**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: all affected projects green. Fix any failures before continuing.

- [ ] **Step 2: Deploy the affected services to dev**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=broker-ctrl,ledger-ctrl,investor-bff,dashboard-bff,ledger-adpt,investor-adpt,execution-adpt | tee /tmp/w5-deploy.log
```
Expected: stacks update cleanly. (advisory-adpt only if Task 1.3 Step 3 changed it.)

- [ ] **Step 2.5: Stream-coalescing verification (the #1 architecture risk)**

After deploy, run a synthetic sim deposit (via `initiateDeposit` against dev or an EB inject of `SIM_DEPOSIT_COMPLETED`) and confirm via CloudWatch / an EventBusTrap that BOTH `DEPOSIT_DETECTED` and `DEPOSIT_SETTLED` are emitted from the two carrier-row INSERTs. If only one fires, the two carriers may be colliding — verify they have distinct `sk` (they do by design: `DEPOSIT_DETECTED` vs `DEPOSIT_SETTLED`) and that the FundingEvent egress filter matches INSERT for both. This is the single highest-risk mechanism in the plan.

- [ ] **Step 3: Integration suites for the changed services**

Run: `pnpm nx affected -t test-integration --base=origin/main`
Expected: broker-ctrl, ledger-ctrl, investor-bff integration green. Key assertions: a deposit moves cash exactly once and a withdrawal moves cash exactly once (the bug-fix gate); `__version` materializes on `Deposit`/`WithdrawalRequest`.

- [ ] **Step 4: Scoped e2e (deposit/funding only — NEVER full suite, NEVER Playwright)**

Run the funding scenarios only, via the env-var launcher (per [[feedback-e2e-nx-wrapper-strips-quotes]]):
```bash
JEST_PATH=src/funding NESTFOLIO_INTEG_PREFIX=dev NODE_OPTIONS='--experimental-vm-modules' pnpm nx run e2e-feature-tests:test-e2e-features
```
Expected: `fund-account.e2e.test.ts` + `withdraw-cash.e2e.test.ts` green. If a scenario fails-then-passes on rerun, pull CloudWatch from the failing window before continuing (flake = real failure; see [[feedback-flake-means-broken]]).

- [ ] **Step 5: Deposit Playwright reload scenario (cost-gated — ASK FIRST)**

The deposit-reload-mid-flight + new-investor-happy-path deposit phases exercise the requested→detected projection latency (see Risk R1). These are Playwright (cost-heavy). Surface via AskUserQuestion before running; do not auto-run Playwright. If approved:
```bash
PLAYWRIGHT_GREP='deposit reload mid-flight' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e
```

- [ ] **Step 6: Commit any test-stabilization fixes**, then proceed to the closing phase (ship the backlog file, regen index, finishing-a-development-branch).

---

## Risks & decision points

- **R1 — requested-projection latency vs deposit-reload-mid-flight (HIGHEST).** Moving `initiateDeposit` off a synchronous `Deposit` row write means the pending deposit is only durable once `DEPOSIT_REQUESTED` round-trips broker-ctrl → investor-adpt → investor-bff projection (several seconds). The `deposit-reload-mid-flight` Playwright scenario asserts the pending panel re-hydrates after F5. If the requested projection has not landed, it fails. **Do NOT band-aid the POM** (per [[feedback-e2e-ui-assertions-only]]). If it fails, this is a real eventual-consistency UX gap — loop back to brainstorming (options: query the `DepositIntent` outbox row as the pending source via a resolver tweak, or accept a brief "submitting…" optimistic state that the page restores from local storage). Flag to the user at Step 5.
- **R2 — `materializeToTable` vs `createIngestionHandler` for persisting handlers.** The router + normalizer now RETURN intents that must be written. Confirm the production export uses the pipeline that persists returned intents (see the note in Task 2.4 Step 3). A wrong choice = carriers silently never written. Covered by the broker-ctrl integration test.
- **R3 — Stream coalescing of the two sim-deposit carriers.** Mitigated by distinct `sk` per transition (distinct items → distinct INSERT stream records). Verified at Step 2.5.
- **R4 — Blast-radius miss on the rename.** `WITHDRAWAL_REQUESTED`/`WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED`/`DEPOSIT_DETECTED` appear across 5+ services + 2 e2e apps + 2 MFEs. Phase 1 + the grep in Phase 5/6 must catch all. Run a final `grep -rn "WITHDRAWAL_COMPLETED\|TRANSFER_FAILED" services/ apps/` before the gate; expected: zero (except intentional history).

## Out of scope (mirror of the spec)

w6 governance/freeze; real-broker Alpaca funding rails (handlers kept wired, not validated); re-touching w1–w4 rows beyond the deposit/withdrawal/cash path; new services; Orders re-architecture; weight-drift detection; deferred `dashboard-live-push-*` transport.
