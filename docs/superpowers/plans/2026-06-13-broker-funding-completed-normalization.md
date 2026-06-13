# Broker funding-completed normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the broker deposit/withdrawal funding chain coherent end-to-end — thread a single funding id (`= depositId/withdrawalId`) through the request and completion hops, type every read via `parseSubject`, and remove the last 4 `as Record<string,unknown>` casts in the repo.

**Architecture:** Approach B (consumer normalizes). Producers keep honest per-producer contracts; the broker-ctrl normalizer branches per event type and `parseSubject`s each producer's contract. The id is made coherent on the request hop: the broker-ctrl router emits a typed `AlpacaTransferRequest` (`transferId = depositId/withdrawalId`); broker-alpaca parses it and threads `nestfolioTransferId = transferId`. The two broker-ctrl↔broker-alpaca boundary contracts (`AlpacaTransferRequest` + `AlpacaTransferResult`) live in `execution-adpt/domain` (alongside `FundingSnapshot`) to avoid the mutual-`/contracts` project cycle.

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`parseSubject`, `materializeToTable`, `createTestHarness`, `fakeSqsRecord`, `record`), Jest, nx, AWS (DynamoDB/EventBridge/Step Functions), Alpaca paper API (mocked in tests).

**Spec:** `docs/superpowers/specs/2026-06-13-broker-funding-completed-normalization-design.md`

---

## Background the executor must know

- **`parseSubject(payload, Schema)`** returns `Schema.parse(payload.subject)` (the typed subject) and throws `NotRetryableError`/ZodError on a malformed subject. In the `createTestHarness` flow a thrown error becomes a `batchItemFailure` (assert `result.batchItemFailures).toHaveLength(1)`), and the thrown handler is fed `payload.subject`.
- **Funding carrier rows** are keyed `pk = Funding#<tenantId>#<transferId>`, `sk = <lifecycle event name>`. `carryForward(deps, tenantId, transferId, requestedEventName, fallback)` does a `GetItem` on `Funding#<tenantId>#<transferId>` / `sk = requestedEventName` and returns `{amountCents, currency, userId, initiatedAt}`, falling back field-by-field to `fallback`. The **requested** carrier (written by the router) is keyed on `depositId`/`withdrawalId` — so the completion MUST present that same id.
- **DRY subjects:** identity (`tenantId`/`userId`/`region`) travels in `RequestContext` (the event `context`), never on the subject.
- **Unit amounts:** funding carriers + investor contracts use **cents** (`amountCents`). The virtual ledger + sim/alpaca result rows use **dollars** (`amount`). Conversion happens at those boundaries (`amountCents / 100`).
- **The existing normalizer + sim-withdrawal unit tests use fictional/co-wrong subject shapes** (e.g. alpaca `{transferId, amountCents}`; sim withdrawal `{amount}`) that the real producers never emit — that is why the drift was never caught. Rewriting these to the real producer shapes is part of the work.
- **Worktree discipline:** commit with `git commit --no-verify` (the pre-commit hook can't run nx-affected in a worktree); verify each commit landed (`git log --oneline -1`). Run tests on real deps, not symlinked node_modules.

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `services/execution/execution-adpt/src/domain/contracts.ts` | Authoritative home for the two broker-ctrl↔broker-alpaca funding boundary contracts (+ existing `FundingSnapshot`) | 1, 2 |
| `services/execution/execution-adpt/src/domain/index.ts` | Re-export the new contracts | 1, 2 |
| `services/execution/execution-adpt/test/contracts.test.ts` | Contract parse tests (new file) | 1, 2 |
| `services/execution/broker-alpaca-adpt/src/domain/contracts.ts` | Remove `AlpacaTransferResultSchema` (moved out) | 2 |
| `services/execution/broker-alpaca-adpt/{handlers/event-listener.ts,handlers/publisher-schemas.ts,test/unit/contracts.test.ts}` | Re-point `AlpacaTransferResult` imports to `execution-adpt/domain` | 2 |
| `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts` | Live branch emits typed `AlpacaTransferRequest` threading `transferId` | 3 |
| `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts` | `processTransferRequested` + reject helper: `parseSubject(AlpacaTransferRequestSchema)`, thread `nestfolioTransferId`, `amountCents/100` | 4 |
| `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` | Split 4 handlers single-producer, `parseSubject` each, key `carryForward` correctly, remove 4 casts | 5 |
| `services/execution/broker-sim-adpt/src/handlers/event-listener.ts` | `SIM_WITHDRAWAL_REQUESTED`: `parseSubject(WithdrawalInitiatedSchema)` + `amountCents` | 6 |
| `services/execution/{broker-ctrl,broker-alpaca-adpt}/test/integration/*.integration.test.ts` | Real-handler integration gates (mocked Alpaca) | 7 |
| `apps/e2e-feature-tests/src/funding/deposit-cash.e2e.test.ts` | New: real sim funding-pipeline e2e (no synthetic injection) | 8 |
| 4× `CLAUDE.md` cards + home-rule docs | Regen + convention extension | 9 |

---

## Task 1: Add `AlpacaTransferRequestSchema` to `execution-adpt/domain`

**Files:**
- Modify: `services/execution/execution-adpt/src/domain/contracts.ts`
- Modify: `services/execution/execution-adpt/src/domain/index.ts`
- Test: `services/execution/execution-adpt/test/contracts.test.ts` (create — match the existing flat `test/` layout, e.g. `test/service.stack.test.ts`)

- [ ] **Step 1: Write the failing test**

Create `services/execution/execution-adpt/test/contracts.test.ts`:

```ts
import { AlpacaTransferRequestSchema } from '../src/domain/contracts';

describe('execution-adpt funding boundary contracts', () => {
  it('AlpacaTransferRequestSchema parses a deposit request (dry, identity in ctx)', () => {
    const parsed = AlpacaTransferRequestSchema.parse({
      transferId: 'dep-1', amountCents: 100000, currency: 'USD',
      direction: 'INCOMING', relationshipId: '',
    });
    expect(parsed.transferId).toBe('dep-1');
    expect(parsed.direction).toBe('INCOMING');
  });

  it('AlpacaTransferRequestSchema rejects a missing transferId', () => {
    expect(() => AlpacaTransferRequestSchema.parse({
      amountCents: 100000, currency: 'USD', direction: 'OUTGOING', relationshipId: '',
    })).toThrow();
  });

  it('AlpacaTransferRequestSchema rejects an invalid direction', () => {
    expect(() => AlpacaTransferRequestSchema.parse({
      transferId: 'wd-1', amountCents: 5000, currency: 'USD', direction: 'IN', relationshipId: '',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NX_DAEMON=false pnpm nx test execution-adpt`
Expected: FAIL — `AlpacaTransferRequestSchema` is not exported from `contracts`.

- [ ] **Step 3: Add the schema**

In `services/execution/execution-adpt/src/domain/contracts.ts`, after `FundingSnapshotSchema`/`FundingSnapshot`, append:

```ts
/**
 * ALPACA_TRANSFER_REQUESTED subject — produced by broker-ctrl's deposit-withdrawal-router
 * (live branch), consumed by broker-alpaca-adpt's event-listener.
 *
 * Hosted here (NOT in broker-ctrl/contracts) because broker-ctrl and broker-alpaca are a
 * MUTUAL producer/consumer pair (broker-ctrl also consumes AlpacaTransferResult); mutual
 * `<svc>/contracts` imports would form a project cycle. Same precedent as FundingSnapshot.
 * DRY — identity travels in RequestContext. `transferId` IS the nestfolio depositId/withdrawalId,
 * threaded end-to-end so the completion can re-find the requested funding carrier.
 */
export const AlpacaTransferRequestSchema = z.object({
  transferId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  relationshipId: z.string(),
});

export type AlpacaTransferRequest = z.infer<typeof AlpacaTransferRequestSchema>;
```

In `services/execution/execution-adpt/src/domain/index.ts`, add:

```ts
export { AlpacaTransferRequestSchema } from './contracts';
export type { AlpacaTransferRequest } from './contracts';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NX_DAEMON=false pnpm nx test execution-adpt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-adpt/src/domain/contracts.ts services/execution/execution-adpt/src/domain/index.ts services/execution/execution-adpt/test/contracts.test.ts
git commit --no-verify -m "feat(execution-adpt): add AlpacaTransferRequest funding boundary contract"
```

---

## Task 2: Move `AlpacaTransferResultSchema` into `execution-adpt/domain`

Single definition, no behavior change. broker-alpaca remains the producer but imports the contract from the domain home (cycle-free; broker-ctrl will consume it from there in Task 5).

**Files:**
- Modify: `services/execution/execution-adpt/src/domain/contracts.ts` (add schema)
- Modify: `services/execution/execution-adpt/src/domain/index.ts` (export)
- Modify: `services/execution/execution-adpt/test/contracts.test.ts` (add parse cases)
- Modify: `services/execution/broker-alpaca-adpt/src/domain/contracts.ts` (remove schema)
- Modify: `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts` (re-point import)
- Modify: `services/execution/broker-alpaca-adpt/src/handlers/publisher-schemas.ts` (re-point import)
- Modify: `services/execution/broker-alpaca-adpt/test/unit/contracts.test.ts` (remove the 2 moved cases)

- [ ] **Step 1: Add the moved schema + its tests in execution-adpt**

In `services/execution/execution-adpt/src/domain/contracts.ts`, append:

```ts
/**
 * ALPACA_TRANSFER_* result subject — the broker-alpaca-adpt `AlpacaTransferResult` row
 * (sk='TransferMapping'). Produced by broker-alpaca-adpt, consumed by broker-ctrl's
 * deposit-withdrawal-normalizer. Hosted here for the same mutual-boundary cycle reason as
 * AlpacaTransferRequest. `nestfolioTransferId` IS the threaded transferId (= depositId/withdrawalId).
 * `timestamp` optional — absent on event-listener emissions (see backlog broker-alpaca-result-timestamp-drift).
 */
export const AlpacaTransferResultSchema = z.object({
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string().optional(),
});

export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;
```

In `services/execution/execution-adpt/src/domain/index.ts`, add:

```ts
export { AlpacaTransferResultSchema } from './contracts';
export type { AlpacaTransferResult } from './contracts';
```

In `services/execution/execution-adpt/test/contracts.test.ts`, add inside the describe:

```ts
  it('AlpacaTransferResultSchema parses an INITIATED transfer subject (dry)', () => {
    expect(AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'dep-1', alpacaTransferId: 'at1', direction: 'INCOMING',
      amount: 500, status: 'INITIATED', timestamp: '2026-06-10T00:00:00.000Z',
    }).direction).toBe('INCOMING');
  });

  it('AlpacaTransferResultSchema parses without timestamp (event-listener emission path)', () => {
    const parsed = AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'wd-1', alpacaTransferId: 'at1', direction: 'OUTGOING',
      amount: 250, status: 'COMPLETED',
    });
    expect(parsed.timestamp).toBeUndefined();
  });
```

Update the import line at the top of the test to include `AlpacaTransferResultSchema`.

- [ ] **Step 2: Remove the schema from broker-alpaca + re-point imports**

In `services/execution/broker-alpaca-adpt/src/domain/contracts.ts`, **delete** the `AlpacaTransferResultSchema` block and its `export type AlpacaTransferResult` line (keep `AlpacaOrderResultSchema`, `AlpacaAccountSnapshotSchema`, `BrokerCircuitEventSchema`, `CircuitBreakerSchema`).

In `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`, change the `AlpacaTransferResult` import to come from `@nestfolio/execution-adpt/domain` (it currently comes from `../domain/contracts`). Keep `AlpacaOrderResult`/`AlpacaAccountSnapshot` from `../domain/contracts`.

In `services/execution/broker-alpaca-adpt/src/handlers/publisher-schemas.ts`, change the `AlpacaTransferResultSchema` import to `@nestfolio/execution-adpt/domain`.

In `services/execution/broker-alpaca-adpt/test/unit/contracts.test.ts`, **remove** the two `AlpacaTransferResultSchema` `it(...)` cases and drop `AlpacaTransferResultSchema` from the import (they now live in the execution-adpt test).

- [ ] **Step 3: Add execution-adpt to broker-alpaca-adpt deps if needed**

Check `services/execution/broker-alpaca-adpt/package.json` (or tsconfig path usage). If `@nestfolio/execution-adpt` isn't already resolvable, no `package.json` edit is needed (workspace path alias is global via `tsconfig.base.json`), but confirm the import resolves.

- [ ] **Step 4: Verify no project cycle introduced**

Run:
```bash
NX_DAEMON=false pnpm nx graph --file=/tmp/g.json >/dev/null 2>&1
node -e 'const d=require("/tmp/g.json").graph.dependencies; const e=p=>(d[p]||[]).map(x=>x.target).filter(t=>!t.startsWith("npm:")); console.log("broker-alpaca-adpt ->",e("broker-alpaca-adpt").join(",")); console.log("broker-ctrl ->",e("broker-ctrl").join(",")); console.log("execution-adpt ->",e("execution-adpt").join(","));'
```
Expected: `broker-alpaca-adpt -> ...,execution-adpt`; `execution-adpt -> ...,broker-ctrl` (NOT broker-alpaca-adpt); **no** `broker-ctrl -> broker-alpaca-adpt`. If `execution-adpt -> broker-alpaca-adpt` appears, a re-export leaked — the schema must be **authored** in execution-adpt, not re-exported from broker-alpaca.

- [ ] **Step 5: Run tests**

Run: `NX_DAEMON=false pnpm nx run-many -t test -p execution-adpt,broker-alpaca-adpt`
Expected: PASS (move is behavior-preserving; the contract parse cases pass in their new home).

- [ ] **Step 6: Commit**

```bash
git add services/execution/execution-adpt services/execution/broker-alpaca-adpt/src/domain/contracts.ts services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts services/execution/broker-alpaca-adpt/src/handlers/publisher-schemas.ts services/execution/broker-alpaca-adpt/test/unit/contracts.test.ts
git commit --no-verify -m "refactor(execution): move AlpacaTransferResult contract to execution-adpt/domain (cycle-free home)"
```

---

## Task 3: Router emits typed `AlpacaTransferRequest` on the live branch

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts`
- Test: `services/execution/broker-ctrl/test/unit/deposit-withdrawal-router.test.ts`

- [ ] **Step 1: Write the failing assertions**

In `deposit-withdrawal-router.test.ts`, **replace** the live-branch deposit test (`'routes to ALPACA_TRANSFER_REQUESTED with direction=INCOMING when mode=live'`) body assertions with the full compound shape:

```ts
    it('routes to ALPACA_TRANSFER_REQUESTED with the typed compound subject when mode=live', async () => {
      build('live');
      await handlers[BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED](
        { subject: { depositId: 'dep-live', amountCents: 5000, currency: 'USD', timestamp: '2026-01-01T00:00:00.000Z' } } as any,
        ctx({ tenantId: 't-2' }),
      );
      const entry = mockEbSend.mock.calls[0][0].input.Entries[0];
      expect(entry).toMatchObject({ DetailType: 'ALPACA_TRANSFER_REQUESTED' });
      const detail = JSON.parse(entry.Detail);
      expect(detail.subject).toMatchObject({
        transferId: 'dep-live', amountCents: 5000, currency: 'USD',
        direction: 'INCOMING', relationshipId: '',
      });
      expect(detail.context.tenantId).toBe('t-2');
    });
```

Add the mirror for withdrawal (replace `'routes to ALPACA_TRANSFER_REQUESTED with direction=OUTGOING when mode=live'`):

```ts
    it('routes to ALPACA_TRANSFER_REQUESTED with the typed compound subject (withdrawal) when mode=live', async () => {
      build('live');
      await handlers[BrokerCtrlInboundEventTypes.WITHDRAWAL_INITIATED](
        { subject: { withdrawalId: 'wd-live', amountCents: 2000, currency: 'USD', timestamp: '2026-01-01T00:00:00.000Z' } } as any,
        ctx({ eventType: 'WITHDRAWAL_INITIATED', tenantId: 't-4' }),
      );
      const detail = JSON.parse(mockEbSend.mock.calls[0][0].input.Entries[0].Detail);
      expect(detail.subject).toMatchObject({
        transferId: 'wd-live', amountCents: 2000, currency: 'USD',
        direction: 'OUTGOING', relationshipId: '',
      });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NX_DAEMON=false pnpm nx test broker-ctrl --testPathPatterns=deposit-withdrawal-router`
Expected: FAIL — live subject currently is `{...DepositInitiated, direction}` with no `transferId`/`relationshipId`.

- [ ] **Step 3: Implement the typed live emission**

In `deposit-withdrawal-router.ts`, add the import:

```ts
import { DepositInitiatedSchema, WithdrawalInitiatedSchema } from '@nestfolio/investor-adpt/domain';
import { type AlpacaTransferRequest } from '@nestfolio/execution-adpt/domain';
```

Rewrite `routeDeposit` so the live branch emits the typed request (sim branch unchanged):

```ts
function routeDeposit(deps: ModeDeps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const subject = parseSubject(payload, DepositInitiatedSchema);
    const mode = await deps.getMode(ctx.tenantId);
    const executionMode = mode === 'live' ? 'live' : 'simulation';
    const transferId = subject.depositId ?? ctx.eventId;
    if (mode === 'live') {
      const req: AlpacaTransferRequest = {
        transferId, amountCents: subject.amountCents, currency: subject.currency ?? 'USD',
        direction: 'INCOMING', relationshipId: '',
      };
      await emitToEventBridge(BrokerCtrlRoutedEventTypes.ALPACA_TRANSFER_REQUESTED, req, ctx);
    } else {
      await emitToEventBridge(BrokerCtrlRoutedEventTypes.SIM_DEPOSIT_INITIATED, { ...subject, direction: 'INCOMING' }, ctx);
    }
    const now = ctx.timestamp;
    logger.info('Deposit routed', { tenantId: ctx.tenantId, mode });
    return fundingCarrier({
      eventName: BrokerCtrlEventTypes.DEPOSIT_REQUESTED, direction: 'DEPOSIT', status: 'requested',
      transferId, tenantId: ctx.tenantId, userId: ctx.userId, region: ctx.region,
      amountCents: subject.amountCents, currency: subject.currency ?? 'USD',
      executionMode, initiatedAt: now, timestamp: now,
    });
  };
}
```

Apply the identical structure to `routeWithdrawal` (use `WithdrawalInitiatedSchema`, `subject.withdrawalId`, `direction: 'OUTGOING'`, `SIM_WITHDRAWAL_REQUESTED` for the sim branch, `WITHDRAWAL_REQUESTED`/`'WITHDRAWAL'` for the carrier).

- [ ] **Step 4: Run to verify it passes**

Run: `NX_DAEMON=false pnpm nx test broker-ctrl --testPathPatterns=deposit-withdrawal-router`
Expected: PASS (all router cases, including the unchanged sim + carrier ones).

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts services/execution/broker-ctrl/test/unit/deposit-withdrawal-router.test.ts
git commit --no-verify -m "feat(broker-ctrl): router emits typed AlpacaTransferRequest threading transferId"
```

---

## Task 4: broker-alpaca parses the request + threads the id

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`
- Test: `services/execution/broker-alpaca-adpt/test/unit/event-listener.test.ts` (diverged inline copy — update to mirror the new logic; the **real-handler gate is the integration test in Task 7**, per the validation decision)

- [ ] **Step 1: Implement the typed transfer handler**

In `event-listener.ts`, add to the event-processor import: `parseSubject`. Add import:

```ts
import { AlpacaTransferRequestSchema, type AlpacaTransferResult } from '@nestfolio/execution-adpt/domain';
```

Rewrite `processTransferRequested` so the subject is parsed ONCE up front (before the breaker check, so the reject path has it) and the id+amount are threaded:

```ts
async function processTransferRequested(payload: EventPayload, ctx: EventContext) {
  const req = parseSubject(payload, AlpacaTransferRequestSchema);
  if (await checkBreaker()) {
    return rejectTransferAsBrokerUnavailable(ctx, req);
  }
  const amount = req.amountCents / 100; // Alpaca ACH amount is dollars
  try {
    const result = await client.initiateTransfer({
      transfer_type: 'ach', direction: req.direction,
      amount: String(amount), relationship_id: req.relationshipId,
    });
    const alpacaTransferId = result.status < 300 ? result.data.id : '';
    const status = result.status < 300 ? 'INITIATED' : 'FAILED';
    const subject: AlpacaTransferResult = {
      nestfolioTransferId: req.transferId, alpacaTransferId,
      direction: req.direction, amount, status,
      failureReason: status === 'FAILED' ? JSON.stringify(result.data) : undefined,
    };
    return record('AlpacaTransferResult', { __typename: 'AlpacaTransferResult', tenantId: ctx.tenantId, ...subject }, {
      pk: `TransferMapping#${ctx.tenantId}#${req.transferId}`, sk: 'TransferMapping',
    });
  } catch (error) {
    const brokerDown = await handleApiFailure(error, ctx);
    const reason = brokerDown ? 'BROKER_UNAVAILABLE' : (error as Error).message;
    const subject: AlpacaTransferResult = {
      nestfolioTransferId: req.transferId, alpacaTransferId: '',
      direction: req.direction, amount, status: 'FAILED', failureReason: reason,
    };
    return record('AlpacaTransferResult', { __typename: 'AlpacaTransferResult', tenantId: ctx.tenantId, ...subject }, {
      pk: `TransferMapping#${ctx.tenantId}#${req.transferId}`, sk: 'TransferMapping',
    });
  }
}
```

Change `rejectTransferAsBrokerUnavailable` to take the parsed request:

```ts
function rejectTransferAsBrokerUnavailable(ctx: EventContext, req: AlpacaTransferRequest) {
  const subject: AlpacaTransferResult = {
    nestfolioTransferId: req.transferId, alpacaTransferId: '',
    direction: req.direction, amount: req.amountCents / 100,
    status: 'FAILED', failureReason: 'BROKER_UNAVAILABLE',
  };
  return record('AlpacaTransferResult', { __typename: 'AlpacaTransferResult', tenantId: ctx.tenantId, ...subject }, {
    pk: `TransferMapping#${ctx.tenantId}#${req.transferId}`, sk: 'TransferMapping',
  });
}
```

Add `AlpacaTransferRequest` to the `execution-adpt/domain` type import. Confirm no remaining `s.transferId`/`s.amount`/`s.relationshipId`/`s.direction as` reads in the transfer paths (grep `s.transfer`, `s.amount`, `s.relationshipId` in this file — there must be none left in transfer handling).

- [ ] **Step 2: Update the diverged unit test's inline reconstruction**

In `event-listener.test.ts`, the local `createHandlers` `[ALPACA_TRANSFER_REQUESTED]` reconstruction and the `ALPACA_TRANSFER_REQUESTED` describe block read `s.transferId`/`s.amount`. Update the inline handler to mirror the real logic (parse `transferId`/`amountCents`/`direction`/`relationshipId`, send `amountCents/100`, set `nestfolioTransferId = transferId`), and update the fixtures from `{ transferId, amount }` to `{ transferId, amountCents, currency, direction, relationshipId }`. Update assertions: `nestfolioTransferId` equals the `transferId`, `amount` equals `amountCents/100`, and `initiateTransfer` was called with `amount: String(amountCents/100)` and `relationship_id: relationshipId`.

> Note: this file remains a diverged copy (parked: `broker-alpaca-event-listener-test-diverged-copy`). The authoritative real-handler coverage is Task 7's integration test.

- [ ] **Step 3: Run unit tests**

Run: `NX_DAEMON=false pnpm nx test broker-alpaca-adpt`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts services/execution/broker-alpaca-adpt/test/unit/event-listener.test.ts
git commit --no-verify -m "fix(broker-alpaca): parse AlpacaTransferRequest, thread transferId + send real amount to Alpaca"
```

---

## Task 5: Normalizer — split handlers, parseSubject per producer, remove the 4 casts

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts`
- Test: `services/execution/broker-ctrl/test/unit/deposit-withdrawal-normalizer.test.ts` (rewrite fixtures to REAL producer shapes)

- [ ] **Step 1: Rewrite the test fixtures to real producer shapes**

In `deposit-withdrawal-normalizer.test.ts`, change the alpaca + sim-withdrawal cases to the REAL emitted subjects. Replace the four non-sim-deposit cases:

```ts
  it('SIM_WITHDRAWAL_COMPLETED → [WITHDRAWAL_SETTLED v3]; carry-forward amountCents wins', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-1' });
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-1', amount: 500, sourceEventId: 'e', timestamp: 't' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', status: 'settled', __version: 3, amountCents: 100000 });
  });

  it('SIM_WITHDRAWAL_COMPLETED → falls back to subject amount*100 when no requested carrier', async () => {
    repo.getRequested.mockResolvedValueOnce(undefined);
    const out = await handlers[BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED](
      { subject: { withdrawalId: 'wd-2', amount: 500, sourceEventId: 'e', timestamp: 't' } } as any,
      ctx({ eventType: 'SIM_WITHDRAWAL_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#wd-2');
    expect((intents[0] as any).fields).toMatchObject({ amountCents: 50000 });
  });

  it('ALPACA_TRANSFER_COMPLETED INCOMING → keys carryForward on nestfolioTransferId → live deposit carriers', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'dep-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { nestfolioTransferId: 'dep-9', alpacaTransferId: 'a1', amount: 500, direction: 'INCOMING', status: 'COMPLETED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(repo.getRequested).toHaveBeenCalledWith('t-1', 'dep-9', 'DEPOSIT_REQUESTED');
    expect(intents.map((i: any) => i.overrides.sk)).toEqual(['DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
    expect((intents[0] as any).fields).toMatchObject({ direction: 'DEPOSIT', executionMode: 'live', amountCents: 100000 });
    expect((intents[0] as any).overrides.pk).toBe('Funding#t-1#dep-9');
  });

  it('ALPACA_TRANSFER_COMPLETED OUTGOING → live withdrawal settled carrier', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED](
      { subject: { nestfolioTransferId: 'wd-9', alpacaTransferId: 'a2', amount: 300, direction: 'OUTGOING', status: 'COMPLETED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_COMPLETED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect(intents).toHaveLength(1);
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_SETTLED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', executionMode: 'live' });
  });

  it('ALPACA_TRANSFER_FAILED INCOMING → DEPOSIT_FAILED with reason, keyed on nestfolioTransferId', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'dep-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { nestfolioTransferId: 'dep-9', alpacaTransferId: '', amount: 250, direction: 'INCOMING', status: 'FAILED', failureReason: 'bank declined' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('DEPOSIT_FAILED');
    expect((intents[0] as any).fields).toMatchObject({ status: 'failed', __version: 3, reason: 'bank declined' });
  });

  it('ALPACA_TRANSFER_FAILED OUTGOING → WITHDRAWAL_FAILED, defaults reason', async () => {
    repo.getRequested.mockResolvedValueOnce({ ...requested, transferId: 'wd-9' });
    const out = await handlers[BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED](
      { subject: { nestfolioTransferId: 'wd-9', alpacaTransferId: '', amount: 100, direction: 'OUTGOING', status: 'FAILED' } } as any,
      ctx({ eventType: 'ALPACA_TRANSFER_FAILED' }),
    );
    const intents = Array.isArray(out) ? out : [out];
    expect((intents[0] as any).overrides.sk).toBe('WITHDRAWAL_FAILED');
    expect((intents[0] as any).fields).toMatchObject({ direction: 'WITHDRAWAL', status: 'failed', reason: 'Transfer failed' });
  });
```

Keep the two `SIM_DEPOSIT_COMPLETED` cases but change their subjects to the real `SimDepositCompleted` shape `{ depositId, amountCents, currency, sourceEventId, timestamp }` (the first already uses `{depositId, amountCents, currency}` — add `sourceEventId`/`timestamp`; the fallback case must use `{ depositId: 'evt-fallback', amountCents: 5000, currency: 'USD', sourceEventId: 'e', timestamp: 't' }` and key on `dep` not `eventId` — note: with the real shape `depositId` is always present, so update the fallback case to assert pk `Funding#t-1#evt-fallback` only if `depositId` equals that value).

- [ ] **Step 2: Run to verify it fails**

Run: `NX_DAEMON=false pnpm nx test broker-ctrl --testPathPatterns=deposit-withdrawal-normalizer`
Expected: FAIL — current handlers read `s.transferId`/`s.amountCents` which are absent on the real shapes.

- [ ] **Step 3: Rewrite the normalizer**

Replace `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` with single-producer handlers (no `as Record` casts):

```ts
import { materializeToTable, requireEnv, parseSubject, type EventPayload, type EventContext, type WriteIntent } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from '../domain/events';
import { fundingCarrier, type FundingDirection } from '../domain/funding';
import { FundingRepository } from '../repositories/funding.repository';
import { SimDepositCompletedSchema, SimWithdrawalCompletedSchema } from '@nestfolio/broker-sim-adpt/contracts';
import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';

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

function depositSettleCarriers(
  transferId: string, executionMode: 'simulation' | 'live',
  cf: { amountCents: number; currency: string; userId: string; initiatedAt: string },
  ctx: EventContext,
): WriteIntent[] {
  const base = {
    direction: 'DEPOSIT' as FundingDirection, transferId, tenantId: ctx.tenantId, userId: cf.userId,
    region: ctx.region, amountCents: cf.amountCents, currency: cf.currency, executionMode,
    initiatedAt: cf.initiatedAt, detectedAt: ctx.timestamp, timestamp: ctx.timestamp,
  } as const;
  return [
    fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_DETECTED, status: 'detected' }),
    fundingCarrier({ ...base, eventName: BrokerCtrlEventTypes.DEPOSIT_SETTLED, status: 'settled', settledAt: ctx.timestamp }),
  ];
}

function withdrawalSettleCarrier(
  transferId: string, executionMode: 'simulation' | 'live',
  cf: { amountCents: number; currency: string; userId: string; initiatedAt: string },
  ctx: EventContext,
): WriteIntent {
  return fundingCarrier({
    eventName: BrokerCtrlEventTypes.WITHDRAWAL_SETTLED, direction: 'WITHDRAWAL', status: 'settled',
    transferId, tenantId: ctx.tenantId, userId: cf.userId, region: ctx.region,
    amountCents: cf.amountCents, currency: cf.currency, executionMode,
    initiatedAt: cf.initiatedAt, settledAt: ctx.timestamp, timestamp: ctx.timestamp,
  });
}

function simDepositCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
    const s = parseSubject(payload, SimDepositCompletedSchema);
    const cf = await carryForward(deps, ctx.tenantId, s.depositId, BrokerCtrlEventTypes.DEPOSIT_REQUESTED, {
      amountCents: s.amountCents, currency: s.currency, userId: ctx.userId, initiatedAt: ctx.timestamp,
    });
    return depositSettleCarriers(s.depositId, 'simulation', cf, ctx);
  };
}

function simWithdrawalCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = parseSubject(payload, SimWithdrawalCompletedSchema);
    const cf = await carryForward(deps, ctx.tenantId, s.withdrawalId, BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED, {
      amountCents: Math.round(s.amount * 100), currency: 'USD', userId: ctx.userId, initiatedAt: ctx.timestamp,
    });
    return withdrawalSettleCarrier(s.withdrawalId, 'simulation', cf, ctx);
  };
}

function alpacaTransferCompletion(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
    const s = parseSubject(payload, AlpacaTransferResultSchema);
    const isDeposit = s.direction === 'INCOMING';
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, s.nestfolioTransferId, requestedName, {
      amountCents: Math.round(s.amount * 100), currency: 'USD', userId: ctx.userId, initiatedAt: ctx.timestamp,
    });
    return isDeposit
      ? depositSettleCarriers(s.nestfolioTransferId, 'live', cf, ctx)
      : withdrawalSettleCarrier(s.nestfolioTransferId, 'live', cf, ctx);
  };
}

function alpacaTransferFailed(deps: Deps) {
  return async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
    const s = parseSubject(payload, AlpacaTransferResultSchema);
    const isDeposit = s.direction === 'INCOMING';
    const requestedName = isDeposit ? BrokerCtrlEventTypes.DEPOSIT_REQUESTED : BrokerCtrlEventTypes.WITHDRAWAL_REQUESTED;
    const cf = await carryForward(deps, ctx.tenantId, s.nestfolioTransferId, requestedName, {
      amountCents: Math.round(s.amount * 100), currency: 'USD', userId: ctx.userId, initiatedAt: ctx.timestamp,
    });
    return fundingCarrier({
      eventName: isDeposit ? BrokerCtrlEventTypes.DEPOSIT_FAILED : BrokerCtrlEventTypes.WITHDRAWAL_FAILED,
      direction: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL', status: 'failed',
      transferId: s.nestfolioTransferId, tenantId: ctx.tenantId, userId: cf.userId, region: ctx.region,
      amountCents: cf.amountCents, currency: cf.currency, executionMode: 'live',
      initiatedAt: cf.initiatedAt, failedAt: ctx.timestamp,
      reason: s.failureReason ?? 'Transfer failed', timestamp: ctx.timestamp,
    });
  };
}

export function createNormalizerHandlers(repo: Pick<FundingRepository, 'getRequested'>) {
  const deps: Deps = { getRequested: repo.getRequested.bind(repo) };
  return {
    [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: simDepositCompletion(deps),
    [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: simWithdrawalCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: alpacaTransferCompletion(deps),
    [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: alpacaTransferFailed(deps),
  };
}

const repo = new FundingRepository(requireEnv('TABLE_NAME'));

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: createNormalizerHandlers(repo),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `NX_DAEMON=false pnpm nx test broker-ctrl --testPathPatterns=deposit-withdrawal-normalizer`
Expected: PASS. Confirm zero `as Record<string,unknown>` remain: `grep -rn "as Record<string, unknown>" services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` → no matches.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts services/execution/broker-ctrl/test/unit/deposit-withdrawal-normalizer.test.ts
git commit --no-verify -m "fix(broker-ctrl): normalizer parseSubject per producer, key carryForward on threaded id, remove 4 casts"
```

---

## Task 6: Sim withdrawal handler reads `amountCents`

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/handlers/event-listener.ts`
- Test: `services/execution/broker-sim-adpt/test/unit/event-listener.test.ts`

- [ ] **Step 1: Rewrite the withdrawal test fixtures to the real shape**

In `event-listener.test.ts`, change every `SIM_WITHDRAWAL_REQUESTED` fixture from `{ withdrawalId, amount: N, ... }` to the real `WithdrawalInitiatedSchema` shape `{ withdrawalId, amountCents: N, currency: 'USD', timestamp: '...' }` (identity in ctx). Update assertions: a withdrawal of `amountCents: 5000` debits `$50` and emits `WithdrawalCompleted` with `amount: 50`. Concretely:
- `'should process WITHDRAWAL_REQUESTED and complete a valid withdrawal'`: `amount: 5000` → `amountCents: 5000, currency: 'USD', timestamp: '2025-01-01T00:00:00.000Z'`; balance mock `{ balance: 100000 }` still passes ($50 ≤ $1000).
- `'should return WithdrawalCompleted record after processing'`: `amount: 50` → `amountCents: 5000, currency: 'USD', timestamp: '...'`; assert `fields.amount: 50` and `fields.withdrawalId: 'wth-1'`.
- The insufficient-balance + duplicate cases: convert `amount` → `amountCents` accordingly (pick cents = dollars×100 to preserve intent).
- `'should throw descriptive error when WITHDRAWAL_REQUESTED has null subject'`: replace with the `parseSubject` failure assertion (mirror the deposit ZodError test):

```ts
  it('SIM_WITHDRAWAL_REQUESTED with empty subject → ZodError → batchItemFailure', async () => {
    const record = fakeSqsRecord('SIM_WITHDRAWAL_REQUESTED', {}, { eventId: 'evt-w-zod', tenantId: 't-1', userId: 'u-1' });
    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NX_DAEMON=false pnpm nx test broker-sim-adpt --testPathPatterns=event-listener`
Expected: FAIL — handler reads `subject.amount` (now undefined).

- [ ] **Step 3: Implement the typed withdrawal handler**

In `event-listener.ts`, add `WithdrawalInitiatedSchema` to the `@nestfolio/investor-adpt/domain` import (`DepositInitiatedSchema` is already there). Rewrite the `SIM_WITHDRAWAL_REQUESTED` handler to mirror the deposit handler:

```ts
    [BrokerSimEventTypes.SIM_WITHDRAWAL_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      // Contract: WithdrawalInitiatedSchema (investor-adpt/domain). Identity travels in ctx.
      const subject = parseSubject(payload, WithdrawalInitiatedSchema);
      const tenantId = ctx.tenantId;
      const userId = ctx.userId ?? tenantId;
      const withdrawalId = subject.withdrawalId;
      const currency = subject.currency ?? 'USD';
      const amount = subject.amountCents / 100; // dollars for the virtual ledger

      const cashBalance = await deps.repository.getCashBalance(tenantId, userId, currency);
      const balance = (cashBalance?.balance as number) ?? 0;
      if (balance < amount) {
        logger.info('Withdrawal rejected: insufficient cash', { withdrawalId, balance, amount });
        return skip();
      }

      const processed = await deps.repository.guardedAddToCashBalance(tenantId, userId, currency, -amount, ctx.eventId);
      if (!processed) {
        logger.info('Withdrawal already processed, skipping', { eventId: ctx.eventId });
      } else {
        logger.info('Withdrawal completed', { withdrawalId, amount, newBalance: balance - amount });
      }

      const withdrawalSubject: SimWithdrawalCompleted = {
        withdrawalId, amount, sourceEventId: ctx.eventId, timestamp: getTime(),
      };
      return record('WithdrawalCompleted', {
        __typename: 'WithdrawalCompleted', tenantId, userId, ...withdrawalSubject,
      }, { pk: `WithdrawalCompleted#${tenantId}#${ctx.eventId}`, sk: 'WithdrawalCompleted' });
    },
```

Remove the now-dead `if (!subject)` guard and the `subject.amount`/`subject.userId`/`subject.withdrawalId as` reads (parseSubject + ctx replace them).

- [ ] **Step 4: Run to verify it passes**

Run: `NX_DAEMON=false pnpm nx test broker-sim-adpt --testPathPatterns=event-listener`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-sim-adpt/src/handlers/event-listener.ts services/execution/broker-sim-adpt/test/unit/event-listener.test.ts
git commit --no-verify -m "fix(broker-sim): SIM_WITHDRAWAL_REQUESTED parses WithdrawalInitiated + amountCents"
```

---

## Task 7: Integration gates (real handlers, mocked Alpaca)

The alpaca unit test is a diverged copy; the **real-handler gate for the request hop is here**. Follow the existing integration suite patterns (read the files first; invoke the `create-integration-test` skill if unsure). Integration suites mock all external APIs (Alpaca client) and drive the deployed-equivalent handler via the event-processor pipeline + a real/local DDB.

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
- Modify: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`

- [ ] **Step 1: broker-alpaca — transfer request integration case**

Add an `it` that sends `ALPACA_TRANSFER_REQUESTED` with the real `AlpacaTransferRequest` subject `{ transferId: 'dep-int-1', amountCents: 5000, currency: 'USD', direction: 'INCOMING', relationshipId: '' }` (identity in ctx), with the Alpaca client mocked to return `{ status: 200, data: { id: 'alpaca-xfr-1' } }`. Assert the resulting `AlpacaTransferResult` row at `pk = TransferMapping#<tenant>#dep-int-1`, `sk = 'TransferMapping'` has `nestfolioTransferId: 'dep-int-1'`, `amount: 50`, `status: 'INITIATED'`, and assert the mocked `initiateTransfer` was called with `amount: '50'` and `relationship_id: ''`.

- [ ] **Step 2: broker-ctrl — funding pipeline normalization integration case**

Add an `it` that (a) seeds a requested carrier via the router (emit `DEPOSIT_INITIATED`, sim mode) producing `Funding#<tenant>#dep-int-2 / DEPOSIT_REQUESTED` with `amountCents: 7000`, then (b) sends `SIM_DEPOSIT_COMPLETED` with the real `SimDepositCompleted` subject `{ depositId: 'dep-int-2', amountCents: 7000, currency: 'USD', sourceEventId: 'x', timestamp: 't' }`. Assert the `DEPOSIT_SETTLED` carrier row exists at `Funding#<tenant>#dep-int-2 / DEPOSIT_SETTLED` with `amountCents: 7000` (carried forward), `status: 'settled'`, `__version: 3`. Add the alpaca-completion mirror: pre-seed `DEPOSIT_REQUESTED` for `dep-int-3`, send `ALPACA_TRANSFER_COMPLETED` `{ nestfolioTransferId: 'dep-int-3', amount: 70, direction: 'INCOMING', status: 'COMPLETED', alpacaTransferId: 'a' }`, assert `DEPOSIT_SETTLED` carrier keyed on `dep-int-3` with `amountCents: 7000` and `executionMode: 'live'` (proves carryForward HITS on the live path — the regression).

- [ ] **Step 3: Run integration locally if the suite supports it, else defer to the deploy gate**

Run: `NX_DAEMON=false pnpm nx run broker-alpaca-adpt:test-integration` and `:test-integration` for broker-ctrl (these require deployed dev — they run in the closing phase Step 6.4 against `--prefix=dev`). If they require deployment, mark this step done after Task 9's deploy.
Expected: PASS (post-deploy).

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/integration services/execution/broker-ctrl/test/integration
git commit --no-verify -m "test(execution): integration gates for typed transfer request + funding normalization (mocked Alpaca)"
```

---

## Task 8: New sim funding-pipeline e2e (real pipeline, no synthetic injection)

Proves the previously-uncovered broker-ctrl funding pipeline end-to-end in sim mode. Model on `apps/e2e-feature-tests/src/funding/withdraw-cash.e2e.test.ts`, but call `initiateDeposit` and let the **real** broker-ctrl→broker-sim→normalizer pipeline drive the result (no synthetic `DEPOSIT_SETTLED` injection).

**Files:**
- Create: `apps/e2e-feature-tests/src/funding/deposit-cash.e2e.test.ts`

- [ ] **Step 1: Write the scenario**

```ts
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, bffClient, waitForGraphQL, type FreshTenant } from '..';
import type { RecentActivityResponse } from '../helpers/graphql-types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

describe('scenario — investor deposits cash (real sim funding pipeline)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  async function enableFlags() {
    const flagTable = await ctx.ssm.tableName('investor-bff');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    await Promise.all(['initiateDeposit'].map(name => ddb.send(new PutCommand({
      TableName: flagTable,
      Item: { pk: 'FeatureFlag#SYSTEM', sk: `FeatureFlag#${name}`, __typename: 'FeatureFlag', name, enabled: true, reason: null },
    }))));
    ddb.destroy();
  }

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await enableFlags();
    await applyFixtures(ctx, tenant, [onboarded()]); // tenant defaults to simulation mode
  }, 600_000);

  afterEach(async () => { await ctx.cleanup.runAll(); }, 60_000);

  it('initiateDeposit flows through the real broker pipeline to a DEPOSIT activity entry', async () => {
    const bff = bffClient(ctx, tenant);
    const deposit = await bff.investor.mutate<{ initiateDeposit: { depositId: string; status: string } }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) { depositId status }
       }`,
      { input: { amountCents: 250_000, currency: 'USD' } },
    );
    expect(deposit.initiateDeposit.status).toBe('REQUESTED');

    // NO synthetic event — the real DEPOSIT_INITIATED → broker-ctrl router → broker-sim →
    // normalizer → DEPOSIT_SETTLED → investor-adpt → dashboard-bff drives this.
    const dashboard = await waitForGraphQL<RecentActivityResponse>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT')),
      { timeoutMs: 240_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify the assertion target wiring**

Confirm `dashboard-bff` surfaces a DEPOSIT activity entry from a deposit-settle event (grep `dashboard-bff` transforms/event-listener for `DEPOSIT_DETECTED`/`DEPOSIT_SETTLED`). If deposits do NOT reach the activity feed, switch the assertion to the investor-bff deposit read-model query (mirror how `requestWithdrawal` returns its row) or `getDashboard` CashBalance reflecting +$2500. Pick the read-model that the real pipeline actually updates — do not add a synthetic event.

- [ ] **Step 3: Run after deploy (closing phase)**

Run (post-deploy, scoped): `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=deposit-cash`
Expected: PASS. If it fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing (flakes are real failures).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/funding/deposit-cash.e2e.test.ts
git commit --no-verify -m "test(e2e): real sim funding-pipeline deposit scenario (no synthetic settle)"
```

---

## Task 9: Service cards, home-rule doc, full affected verification

**Files:**
- Modify: `services/execution/{broker-ctrl,broker-alpaca-adpt,broker-sim-adpt,execution-adpt}/CLAUDE.md`
- Modify: home-rule convention doc(s)

- [ ] **Step 1: Regenerate the affected service cards**

For each of the 4 services, regenerate the `## Event Payload Contracts` / `## Handlers` sections to reflect: `AlpacaTransferRequest` + `AlpacaTransferResult` now in `execution-adpt/domain`; broker-alpaca no longer owns `AlpacaTransferResult`; broker-ctrl normalizer/router now `parseSubject` typed; broker-sim withdrawal typed. Use `audit-service <svc>` or hand-edit per the card-drift convention. Add to broker-ctrl deps: `@nestfolio/broker-sim-adpt/contracts` + `@nestfolio/execution-adpt/domain` (value imports now). Add to broker-alpaca deps: `@nestfolio/execution-adpt/domain`.

- [ ] **Step 2: Document the home-rule extension**

Find where the typed-subject home rule is documented as a live convention:
```bash
grep -rln "Intra-domain consumer\|home rule\|producer.s adapter /domain" docs/architecture .claude/skills
```
Add the clause: *"Intra-domain **mutual** producer/consumer boundary (each service produces an event the other consumes) → the boundary contracts live in the domain adapter `/domain` (authored there, imported by both), not in either service's `/contracts` — mirrors the cross-domain rule and avoids the A↔B project cycle. Precedent: `execution-adpt/domain` (FundingSnapshot, AlpacaTransferRequest, AlpacaTransferResult)."*

- [ ] **Step 3: Doc-derivation check**

Run: `node .claude/skills/backlog-next/detect-doc-derivation.mjs` — run any derivations it lists (e.g. flow specs touching the funding path) and resolve inconsistencies.

- [ ] **Step 4: Full affected test + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && NX_DAEMON=false pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: all PASS. Re-confirm no new cycle (`nx graph`) and zero `as Record<string,unknown>` in the repo for the funding files:
```bash
grep -rn "as Record<string, unknown>" services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts
```
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit --no-verify -m "docs(execution): regen service cards + home-rule mutual-boundary clause"
```

---

## Self-review (completed during planning)

**Spec coverage:** Goal 1 (coherent chain) → Tasks 3,4,5,6. Goal 2 (parseSubject + remove 4 casts) → Tasks 4,5 (+ verified Step 9.4). Goal 3 (sim withdrawal) → Task 6. Goal 4 (no cycle / contract home) → Tasks 1,2 (+ graph check 2.4, 9.4). Validation (unit+integration+sim e2e) → Tasks 3-6 (unit), 7 (integration), 8 (e2e). Convention extension → Task 9. ✓

**Placeholder scan:** Two intentional empiricals carry explicit verification steps, not vague TODOs: Task 8 Step 2 (confirm the deposit-activity read-model target) and Task 9 Step 2 (grep for the home-rule doc location). Both name the exact command + fallback. ✓

**Type consistency:** `AlpacaTransferRequest{transferId,amountCents,currency,direction,relationshipId}` and `AlpacaTransferResult{nestfolioTransferId,alpacaTransferId,direction,amount,status,failureReason?,timestamp?}` are used identically across Tasks 1-5. `transferId`(request) ≡ `nestfolioTransferId`(result) ≡ `depositId`/`withdrawalId`. Carrier fields (`amountCents`,`currency`,`executionMode`,`status`,`__version`) match the existing `fundingCarrier`/`FundingSnapshot` shape. `carryForward` signature unchanged. ✓

## Out of scope (per spec §2)

`relationshipId`/ACH bank-linking; rewriting `funded()`/`withdraw-cash` fixtures; the alpaca diverged-copy unit-test refactor (parked); `broker-ctrl-order-sf-input-contract-gap`; `ledger-ctrl-live-tax-lot-missing-order-fields`; `broker-ctrl-alpaca-funding-carrier-pk-divergence`; sim completion amount-unit asymmetry normalization at the producer; real live-alpaca e2e.
```
