# WS-2 — execution-ctrl per-trade order expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make execution-ctrl read the `proposedTrades` carried on its authorizing events (WS-1) and expand them into N single-symbol `Order` rows, each emitting its own `ORDER_SUBMITTED`/`ORDER_STAGED`/`ORDER_REJECTED` carrying `symbol`/`side`/`quantityOrAmountCents`.

**Architecture:** Hop 2 of the order-execution money path (spec `docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md` §4 hop 2, §3, §7). `DECISION_APPROVED` (ComplianceCheck) and `USER_CONFIRMED` (UserConfirmation) now carry `proposedTrades` (opaque `unknown[]`, WS-1). execution-ctrl parses them to typed `ProposedTrade[]`, evaluates market-open once + safety checks per-trade, and writes one `Order` row per trade keyed `Order#<tenant>#<eventId>#<index>`. Per-trade expansion makes every emitted order single-symbol, so the broker SF's existing single-instrument model fits unchanged (resolves break C). The amount→shares conversion stays downstream in WS-3.

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`materializeToTable`, `record`, `skip`, `parseSubject`), `@nestfolio/advisory-adpt/domain` (`ProposedTradeSchema`/`ComplianceCheckSchema`/`UserConfirmationSchema`), Jest (`createTestHarness`/`fakeSqsRecord` unit; `EventBusTrap`/`createIntegrationTestContext` integration), Nx.

## Global Constraints

- DRY subjects — identity (`tenantId`/`userId`/`region`) travels in `RequestContext` (event context), NEVER on the emitted subject. (`CLAUDE.md` Hard Constraints; `read-model-ownership.ts`.)
- `Order`/`StagedOrder` stay **CommandOwned** — created via `record()`. Do NOT introduce `projectVersioned` (typecheck enforces it via `test/types/read-model-ownership.type-test.ts`).
- Per-trade `orderId` MUST be deterministic: `` `${authorizingEventId}#${index}` `` (authorizing event id + trade array index). `record()` idempotency is keyed on `pk = Order#<tenant>#<orderId>` via `attribute_not_exists(pk)`, so redelivery must reproduce the same N pks. (User decision 2026-06-20.)
- Order fate is **independent per-trade**: market-open evaluated ONCE per decision (shared); safety checks run per-trade. Each `Order` is independently `SUBMITTED`/`STAGED`/`REJECTED`. (User decision 2026-06-20.)
- Zero/absent `proposedTrades` on an approved decision ⇒ `skip()` + `logger.warn` (no `Order` rows, no CDC). (User decision 2026-06-20.)
- The emitted `ORDER_SUBMITTED` carries `quantityOrAmountCents` (the dollar amount). Do NOT name it `quantity` or convert to shares — that is WS-3 (route-order/broker-sim, §3).
- Run all tasks through `pnpm nx`, never the underlying tool. Unit tests: `pnpm nx test execution-ctrl`. Nx auto-loads repo-root `.env` (`AWS_PROFILE=nestfolio-dev`).
- Commits in the worktree need `--no-verify` (the pre-commit hook can't run nx-affected in a worktree); verify each commit landed (never trust an echo).

## File Structure

- `services/execution/execution-ctrl/src/domain/contracts.ts` — **modify.** `OrderSchema` + `StagedOrderSchema`: replace `proposedTrades: z.array(z.unknown())` with typed `symbol`/`side`/`quantityOrAmountCents`.
- `services/execution/execution-ctrl/src/domain/schemas.ts` — **delete.** Holds the dead, contradictory `OrderSubmittedSchema` (zero real importers; superseded by the new `OrderSchema`).
- `services/execution/execution-ctrl/src/domain/index.ts` — **modify.** Drop the `OrderSubmittedSchema` re-export.
- `services/execution/execution-ctrl/src/services/safety-checks.service.ts` — **modify.** `runAllChecks(tenantId, instruments: string[])` (was `ProposedTrade[]`); drops the `ProposedTrade` coupling.
- `services/execution/execution-ctrl/src/handlers/event-listener.ts` — **modify.** Typed `proposedTrades` parse + per-trade expansion (the core change).
- `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts` — **modify.** Read the single-trade `symbol` off the `StagedOrder` row; pass `[symbol]` to `runAllChecks`.
- `services/execution/execution-ctrl/src/repositories/order.repository.ts` — **modify.** `getConflictingStagedOrders` filters on the row's single `symbol` (not `proposedTrades[]`).
- `services/execution/execution-ctrl/test/unit/{event-listener,safety-checks.service,staged-order-processor,order.repository}.test.ts` — **modify.**
- `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts` — **modify.** Inject `DECISION_APPROVED`/`USER_CONFIRMED` carrying `proposedTrades`; assert N per-symbol CDC events.
- `services/execution/execution-ctrl/CLAUDE.md` — **regenerate** (Task 4, `audit-service`).

**Not touched (verified out of scope):** CDK stack (egress event names unchanged), `read-model-ownership.ts` (still CommandOwned), `publisher-schemas.ts` (still `Order→OrderSchema`), `@nestfolio/test-contracts` (execution-ctrl `ORDER_*` are not registered — confirmed absent from `tools/typed-fixture-registered-events.json`), `flows/*.flow.yaml` (WS-5), broker-ctrl/broker-sim (WS-3; `broker-sim-adpt` consumes `SIM_ORDER_REQUESTED`, not `ORDER_SUBMITTED`). `OrderRepository.createOrder`/`createStagedOrder` are dead (filed: `execution-ctrl-orderrepository-prune-unused-methods`) — leave untouched; they compile (build loose `TableEntry`s) and have zero callers.

---

### Task 1: Decouple SafetyChecksService from ProposedTrade (`instruments: string[]`)

`runAllChecks` only ever uses `t.symbol`. Per-trade expansion calls it with a single instrument, and the staged processor with the staged row's one symbol. Switching the signature to `instruments: string[]` removes the awkward partial-`ProposedTrade` reconstruction the staged processor would otherwise need, and makes the safety service reusable on bare instruments.

**Files:**
- Modify: `services/execution/execution-ctrl/src/services/safety-checks.service.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts` (call site only, this task)
- Modify: `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts` (call site only, this task)
- Test: `services/execution/execution-ctrl/test/unit/safety-checks.service.test.ts`

**Interfaces:**
- Produces: `SafetyChecksService.runAllChecks(tenantId: string, instruments: string[]): Promise<SafetyCheckResult>` (unchanged `SafetyCheckResult`).

- [ ] **Step 1: Update the safety-checks unit test to pass instruments**

In `test/unit/safety-checks.service.test.ts`, every `runAllChecks(tenantId, <trades>)` call must pass a `string[]` of symbols instead of `ProposedTrade[]`. Find each call and replace the trades argument with the symbols, e.g.:

```typescript
// before: await service.runAllChecks('t1', [{ symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 100, targetWeightPercent: 50, rationale: 'x' }]);
const result = await service.runAllChecks('t1', ['VTI']);
```

Update any assertions that referenced the trade objects to reference symbols. Keep every existing scenario (reconciliation lock, conflicting staged, cooldown, all-pass).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test execution-ctrl --test-file=safety-checks.service.test.ts`
Expected: FAIL — `runAllChecks` still types its 2nd param as `ProposedTrade[]`, so `['VTI']` is a type error / the assertions mismatch.

- [ ] **Step 3: Change the `runAllChecks` signature**

In `src/services/safety-checks.service.ts`: remove the `import type { ProposedTrade } ...` line, and change `runAllChecks`:

```typescript
  readonly runAllChecks = this.log('runAllChecks',
    async (tenantId: string, instruments: string[]): Promise<SafetyCheckResult> => {
      const reconciliationLock = await this.checkReconciliationLock(tenantId);
      if (reconciliationLock) {
        return {
          passed: false,
          reason: 'Reconciliation is in progress',
          checks: { reconciliationLock: true, conflictingStagedOrders: false, coolDown: false },
        };
      }

      const conflictingStagedOrders = await this.checkConflictingStagedOrders(tenantId, instruments);
      if (conflictingStagedOrders) {
        return {
          passed: false,
          reason: 'Conflicting staged orders exist for the same instruments',
          checks: { reconciliationLock: false, conflictingStagedOrders: true, coolDown: false },
        };
      }

      const coolDown = await this.checkCoolDown(tenantId, instruments);
      if (coolDown) {
        return {
          passed: false,
          reason: 'Cool down period active for one or more instruments',
          checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: true },
        };
      }

      return {
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
      };
    },
  );
```

(The body is identical except the removed `const instruments = proposedTrades.map((t) => t.symbol);` line — `instruments` is now the parameter.)

- [ ] **Step 4: Adjust the two call sites so the service still compiles**

`src/handlers/event-listener.ts` — `processApprovedDecision` currently calls `runAllChecks(tenantId, proposedTrades)`. Change to:

```typescript
  const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, proposedTrades.map((t) => t.symbol));
```

(`proposedTrades` is still `[]` here until Task 2 — `[].map(...)` is `[]`, so behaviour is unchanged.)

`src/handlers/staged-order-processor.ts` — change the `runAllChecks` call:

```typescript
        const proposedTrades = (staged['proposedTrades'] ?? []) as ProposedTrade[];
        const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, proposedTrades.map((t) => t.symbol));
```

(Still reads the old `proposedTrades` field here — replaced in Task 2.)

- [ ] **Step 5: Run safety + all execution-ctrl unit tests to verify green**

Run: `pnpm nx test execution-ctrl`
Expected: PASS (all unit suites; behaviour unchanged, only the safety signature moved).

- [ ] **Step 6: Commit**

```bash
git add services/execution/execution-ctrl/src/services/safety-checks.service.ts \
        services/execution/execution-ctrl/src/handlers/event-listener.ts \
        services/execution/execution-ctrl/src/handlers/staged-order-processor.ts \
        services/execution/execution-ctrl/test/unit/safety-checks.service.test.ts
git commit --no-verify -m "refactor(execution-ctrl): SafetyChecksService.runAllChecks takes instruments: string[] (WS-2)"
```

---

### Task 2: Per-trade order expansion (contracts + handler + staged processor + repository)

The atomic behavioural change: reshape the `Order`/`StagedOrder` subjects to single-symbol, parse the authorizing event's `proposedTrades` to typed `ProposedTrade[]`, and expand to N orders with independent per-trade fate. Reshaping `OrderSchema` and the handler must change together to compile, so they are one task; the staged processor + repository read the new single-symbol row shape, and all affected unit tests move with them.

**Files:**
- Modify: `services/execution/execution-ctrl/src/domain/contracts.ts`
- Delete: `services/execution/execution-ctrl/src/domain/schemas.ts`
- Modify: `services/execution/execution-ctrl/src/domain/index.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts`
- Modify: `services/execution/execution-ctrl/src/repositories/order.repository.ts`
- Test: `services/execution/execution-ctrl/test/unit/event-listener.test.ts`
- Test: `services/execution/execution-ctrl/test/unit/staged-order-processor.test.ts`
- Test: `services/execution/execution-ctrl/test/unit/order.repository.test.ts`

**Interfaces:**
- Consumes: `ProposedTradeSchema` (value) + `ProposedTrade`, `ComplianceCheckSchema`, `UserConfirmationSchema` from `@nestfolio/advisory-adpt/domain`; `SafetyChecksService.runAllChecks(tenantId, instruments: string[])` (Task 1); `record`/`skip`/`parseSubject`/`getTime` from `@nestfolio/event-processor`.
- Produces: `Order = { orderId, decisionPacketId, symbol, side: 'BUY'|'SELL', quantityOrAmountCents: number, status: 'SUBMITTED'|'STAGED'|'REJECTED'|'PENDING', reason?, sourceEventId?, timestamp }`; `StagedOrder = { orderId, symbol, side, quantityOrAmountCents, stagedAt, timestamp }`. Per-trade `orderId = ` `` `${authorizingEventId}#${index}` ``; `Order` pk `` `Order#${tenantId}#${orderId}` ``, `StagedOrder` pk `` `StagedOrder#${tenantId}#${orderId}` ``.

- [ ] **Step 1: Reshape the contracts**

Replace the two schemas in `src/domain/contracts.ts` (keep the file's header comment; update the `OrderSchema`/`StagedOrderSchema` docblocks to describe single-symbol orders):

```typescript
export const OrderSchema = z.object({
  orderId: z.string(),
  decisionPacketId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  status: z.enum(['SUBMITTED', 'STAGED', 'REJECTED', 'PENDING']),
  reason: z.string().optional(),
  sourceEventId: z.string().optional(),
  timestamp: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const StagedOrderSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  stagedAt: z.string(),
  timestamp: z.string(),
});
export type StagedOrder = z.infer<typeof StagedOrderSchema>;
```

(`'PENDING'` stays in the `status` enum — it is the dead `OrderRepository.createOrder` value, kept until that method is pruned by `execution-ctrl-orderrepository-prune-unused-methods`.)

- [ ] **Step 2: Delete the dead `OrderSubmittedSchema`**

```bash
rm services/execution/execution-ctrl/src/domain/schemas.ts
```

In `src/domain/index.ts`, delete the line `export { OrderSubmittedSchema } from './schemas';`. (Verify zero other importers — already confirmed; re-confirm with `grep -rn "OrderSubmittedSchema\|domain/schemas" services/execution/execution-ctrl/src libs apps` returning nothing but this removal.)

- [ ] **Step 3: Write the failing event-listener tests**

Rewrite `test/unit/event-listener.test.ts`. Keep the mock block (lines 1–74) and the harness setup unchanged. Replace the fixtures + the `--- WriteIntent tests ---` block with per-trade cases. Add a trade builder and put `proposedTrades` on the fixtures:

```typescript
function trade(symbol: string, side: 'BUY' | 'SELL' = 'BUY', quantityOrAmountCents = 50000): Record<string, unknown> {
  return { symbol, assetClass: 'EQUITY', side, quantityOrAmountCents, targetWeightPercent: 50, rationale: 'r' };
}

function complianceCheckSubject(decisionPacketId: string, proposedTrades: Record<string, unknown>[]): Record<string, unknown> {
  return {
    ccId: 'cc-test',
    decisionPacketId,
    decisionId: decisionPacketId,
    taskToken: 'tok',
    mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2025-01-01' },
    status: 'COMPLETED',
    result: 'APPROVED',
    violations: [],
    authorityLevel: 'L1',
    proposedTrades,
    sourceEventId: 'src-evt',
  };
}

function userConfirmationSubject(decisionId: string, proposedTrades: Record<string, unknown>[]): Record<string, unknown> {
  return {
    decisionId,
    confirmedAt: '2025-01-01T00:00:00.000Z',
    confirmedBy: 'user-1',
    timestamp: '2025-01-01T00:00:00.000Z',
    proposedTrades,
  };
}

const pass = { passed: true as const, checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false } };
```

Test cases (replace the old `it` blocks):

```typescript
it('DECISION_APPROVED with 2 trades + safety pass + market open → 2 SUBMITTED Order records, one per symbol', async () => {
  jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
  jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

  const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-1', [trade('VTI'), trade('BND', 'SELL', 30000)]), { eventId: 'evt-1', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);

  expect(result.batchItemFailures).toHaveLength(0);
  expect(result.intents).toHaveLength(2);
  const orders = result.intents.filter((i: any) => i.typename === 'Order');
  expect(orders).toHaveLength(2);
  expect(orders.map((o: any) => o.overrides.pk).sort()).toEqual(['Order#t1#evt-1#0', 'Order#t1#evt-1#1']);
  expect(orders.map((o: any) => o.fields.symbol).sort()).toEqual(['BND', 'VTI']);
  orders.forEach((o: any) => {
    expect(o.fields).toEqual(expect.objectContaining({ status: 'SUBMITTED', decisionPacketId: 'dp-1' }));
    expect(o.fields).not.toHaveProperty('proposedTrades');
  });
});

it('per-trade independence: one symbol fails safety → that order REJECTED, the other SUBMITTED', async () => {
  jest.spyOn(safetyChecks, 'runAllChecks').mockImplementation(async (_t: string, instruments: string[]) =>
    instruments.includes('BAD')
      ? { passed: false, reason: 'Cool down period active', checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: true } }
      : pass,
  );
  jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

  const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-2', [trade('GOOD'), trade('BAD')]), { eventId: 'evt-2', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);

  expect(result.batchItemFailures).toHaveLength(0);
  const bySymbol = Object.fromEntries(result.intents.map((i: any) => [i.fields.symbol, i.fields]));
  expect(bySymbol['GOOD'].status).toBe('SUBMITTED');
  expect(bySymbol['BAD']).toEqual(expect.objectContaining({ status: 'REJECTED', reason: 'Cool down period active' }));
});

it('DECISION_APPROVED + market closed → per trade: STAGED Order + StagedOrder sibling', async () => {
  jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
  jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(false);

  const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-3', [trade('VTI')]), { eventId: 'evt-3', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);

  expect(result.intents).toHaveLength(2);
  const order = result.intents.find((i: any) => i.typename === 'Order');
  const staged = result.intents.find((i: any) => i.typename === 'StagedOrder');
  expect(order.fields).toEqual(expect.objectContaining({ status: 'STAGED', symbol: 'VTI' }));
  expect(staged.fields).toEqual(expect.objectContaining({ orderId: 'evt-3#0', symbol: 'VTI', tenantId: 't1' }));
  expect(staged.overrides.pk).toBe('StagedOrder#t1#evt-3#0');
});

it('USER_CONFIRMED with trades → SUBMITTED Order using subject.decisionId as decisionPacketId', async () => {
  jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
  jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

  const sqsRecord = fakeSqsRecord('USER_CONFIRMED', userConfirmationSubject('dec-id-4', [trade('VTI')]), { eventId: 'evt-4', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);

  expect(result.intents).toHaveLength(1);
  expect(result.intents[0].fields).toEqual(expect.objectContaining({ status: 'SUBMITTED', decisionPacketId: 'dec-id-4', symbol: 'VTI' }));
});

it('approved decision with zero trades → skip() (no Order rows)', async () => {
  const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-empty', []), { eventId: 'evt-empty', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);

  expect(result.batchItemFailures).toHaveLength(0);
  expect(result.intents).toHaveLength(1);
  expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
});

it('ACCOUNT_CLOSURE_REQUESTED → returns skip()', async () => {
  const sqsRecord = fakeSqsRecord('ACCOUNT_CLOSURE_REQUESTED', {}, { eventId: 'evt-ac', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);
  expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
});

it('should skip unknown event types gracefully', async () => {
  const sqsRecord = fakeSqsRecord('UNKNOWN_EVENT', {}, { eventId: 'evt-unk', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);
  expect(result.batchItemFailures).toHaveLength(0);
  expect(result.skipped).toBe(1);
});

it('should report batch item failures for processing errors', async () => {
  jest.spyOn(safetyChecks, 'runAllChecks').mockRejectedValueOnce(new Error('Safety check error'));
  const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-fail', [trade('VTI')]), { eventId: 'evt-fail', tenantId: 't1' });
  const result = await harness.process([sqsRecord]);
  expect(result.batchItemFailures).toHaveLength(1);
  expect(result.errors).toHaveLength(1);
});
```

(`result.intents` is the flattened intent list — proven by the prior market-closed test asserting `toHaveLength(2)` for a `[Order, StagedOrder]` return. The `_tag`/`typename`/`fields`/`overrides` shape is `record()`'s — see `libs/event-processor/src/intents/record.ts`.)

- [ ] **Step 4: Run the event-listener test to verify it fails**

Run: `pnpm nx test execution-ctrl --test-file=event-listener.test.ts`
Expected: FAIL — handler still hard-codes `proposedTrades: []`, creates one order keyed on `ctx.eventId`, and the `Order` type lacks `symbol`.

- [ ] **Step 5: Rewrite the event-listener handler**

Replace the top imports + the `ApprovedDecision`/`fromDecisionApproved`/`fromUserConfirmed`/`processApprovedDecision` block in `src/handlers/event-listener.ts`:

```typescript
import { logger, getTime, parseSubject } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { z } from 'zod';
import { materializeToTable, record, skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import '../read-model-ownership';
import { AdvisoryCrossDomainEventTypes, ComplianceCheckSchema, UserConfirmationSchema, ProposedTradeSchema, type ProposedTrade } from '@nestfolio/advisory-adpt/domain';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import type { Order, StagedOrder } from '../domain/contracts';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';

export interface EventListenerDeps {
  readonly safetyChecks: SafetyChecksService;
  readonly marketHours: MarketHoursService;
}

const ProposedTradesArray = z.array(ProposedTradeSchema);

interface ApprovedDecision {
  tenantId: string;
  authorizingEventId: string;
  decisionPacketId: string;
  proposedTrades: ProposedTrade[];
}

// DECISION_APPROVED = ComplianceCheck. proposedTrades carried on the subject since WS-1
// (opaque unknown[]); parsed to typed ProposedTrade[] here. A malformed trade ⇒ ZodError ⇒ DLQ.
function fromDecisionApproved(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, ComplianceCheckSchema);
  return {
    tenantId: ctx.tenantId ?? '',
    authorizingEventId: ctx.eventId,
    decisionPacketId: subject.decisionPacketId,
    proposedTrades: ProposedTradesArray.parse(subject.proposedTrades ?? []),
  };
}

// USER_CONFIRMED = UserConfirmation. Carries decisionId (not decisionPacketId) + proposedTrades (WS-1).
function fromUserConfirmed(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, UserConfirmationSchema);
  return {
    tenantId: ctx.tenantId ?? '',
    authorizingEventId: ctx.eventId,
    decisionPacketId: subject.decisionId,
    proposedTrades: ProposedTradesArray.parse(subject.proposedTrades ?? []),
  };
}

async function processApprovedDecision(
  deps: EventListenerDeps,
  approved: ApprovedDecision,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
  const { tenantId, authorizingEventId, decisionPacketId, proposedTrades } = approved;
  const now = getTime();

  if (proposedTrades.length === 0) {
    logger.warn('Approved decision carried no proposed trades — nothing to execute', { tenantId, decisionPacketId, authorizingEventId });
    return skip();
  }

  const marketOpen = await deps.marketHours.isMarketOpen();
  logger.info('Expanding approved decision into per-trade orders', { tenantId, decisionPacketId, authorizingEventId, tradeCount: proposedTrades.length, marketOpen });

  const intents: WriteIntent[] = [];

  for (const [index, t] of proposedTrades.entries()) {
    const orderId = `${authorizingEventId}#${index}`;
    const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, [t.symbol]);

    const base = {
      orderId,
      decisionPacketId,
      symbol: t.symbol,
      side: t.side,
      quantityOrAmountCents: t.quantityOrAmountCents,
      sourceEventId: ctx.eventId,
      timestamp: now,
    };
    const orderRow = (order: Order): WriteIntent =>
      record('Order', { __typename: 'Order', tenantId, ...order, createdAt: now, updatedAt: now }, { pk: `Order#${tenantId}#${orderId}`, sk: 'Order' });

    if (!safetyResult.passed) {
      logger.info('Safety checks failed, rejecting order', { orderId, symbol: t.symbol, reason: safetyResult.reason });
      intents.push(orderRow({ ...base, status: 'REJECTED', reason: safetyResult.reason }));
      continue;
    }

    if (marketOpen) {
      intents.push(orderRow({ ...base, status: 'SUBMITTED' }));
      continue;
    }

    const stagedSubject: StagedOrder = { orderId, symbol: t.symbol, side: t.side, quantityOrAmountCents: t.quantityOrAmountCents, stagedAt: now, timestamp: now };
    intents.push(
      orderRow({ ...base, status: 'STAGED' }),
      record('StagedOrder', { __typename: 'StagedOrder', tenantId, ...stagedSubject }, { pk: `StagedOrder#${tenantId}#${orderId}`, sk: 'StagedOrder' }),
    );
  }

  return intents;
}
```

Leave `createHandlers` + the production wiring (below `processApprovedDecision`) unchanged.

- [ ] **Step 6: Update the repository conflict check for single-symbol StagedOrder rows**

In `src/repositories/order.repository.ts`, `getConflictingStagedOrders` (the StagedOrder rows are now single-symbol):

```typescript
  readonly getConflictingStagedOrders = this.log('getConflictingStagedOrders',
    async (
      tenantId: string,
      instruments: string[],
    ): Promise<Record<string, unknown>[]> => {
      const staged = await this.getStagedOrders(tenantId);
      return staged.filter((order) => instruments.includes(order['symbol'] as string));
    },
  );
```

- [ ] **Step 7: Update the staged-order processor to read the single symbol**

In `src/handlers/staged-order-processor.ts`, replace the per-row body (drop the `ProposedTrade` import too):

```typescript
    for (const staged of stagedOrders) {
      const tenantId = staged['tenantId'] as string;
      const orderId = staged['orderId'] as string;
      const symbol = staged['symbol'] as string;

      try {
        const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, symbol ? [symbol] : []);
```

(Leave the submit/reject/delete branches below unchanged.) Remove `import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';` (now unused).

- [ ] **Step 8: Update the staged-order-processor + order.repository unit tests**

In `test/unit/staged-order-processor.test.ts`: the staged-row fixtures must carry a single `symbol` (and `side`/`quantityOrAmountCents`) instead of `proposedTrades: [...]`. Update each seeded `StagedOrder` row, and any assertion that referenced `proposedTrades`. The submit/reject expectations are unchanged (keyed on `runAllChecks` pass/fail → `updateOrderStatus`).

In `test/unit/order.repository.test.ts`: update the `getConflictingStagedOrders` test — seed `StagedOrder` rows with `symbol: 'VTI'` (not `proposedTrades: [{symbol:'VTI'}]`) and assert it returns the row when `instruments` includes `'VTI'`.

- [ ] **Step 9: Run the full execution-ctrl unit suite to verify green**

Run: `pnpm nx test execution-ctrl`
Expected: PASS (event-listener, safety-checks, staged-order-processor, order.repository, market-hours).

- [ ] **Step 10: Typecheck the read-model-ownership invariant**

Run: `pnpm nx run execution-ctrl:typecheck`
Expected: PASS — `Order`/`StagedOrder` remain CommandOwned; no `projectVersioned` introduced.

- [ ] **Step 11: Lint**

Run: `pnpm nx lint execution-ctrl`
Expected: PASS (no unused `ProposedTrade` import remaining; no `schemas` re-export).

- [ ] **Step 12: Commit**

```bash
git add services/execution/execution-ctrl/src services/execution/execution-ctrl/test/unit
git rm services/execution/execution-ctrl/src/domain/schemas.ts
git commit --no-verify -m "feat(execution-ctrl): expand proposedTrades into N per-symbol Order rows (WS-2)

- OrderSchema/StagedOrderSchema carry symbol/side/quantityOrAmountCents (was proposedTrades[])
- event-listener parses authorizing-event proposedTrades → typed ProposedTrade[], emits one
  Order per trade keyed Order#<tenant>#<eventId>#<index> (deterministic, idempotent)
- per-trade safety + fate; zero trades → skip(); market-open evaluated once
- delete dead OrderSubmittedSchema
- repository/staged-processor read single-symbol StagedOrder rows"
```

---

### Task 3: Integration test — N per-symbol CDC events from one authorizing event

Deploy-gated coverage of hops 1–2: inject `DECISION_APPROVED`/`USER_CONFIRMED` carrying `proposedTrades` and assert one `ORDER_*` CDC event per trade, each subject carrying `symbol`/`side`/`quantityOrAmountCents`. Runs in the closing phase against deployed dev (Task is the file edit; execution is `Step 3`).

**Files:**
- Modify: `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`

**Interfaces:**
- Consumes: deployed dev execution-ctrl (Task 2 must be deployed before running). `EventBusTrap.waitForEvent({ match, timeoutMs })`, `EventBridgeClient.putEvent`.

- [ ] **Step 1: Replace the two order-creation cases with per-trade expansion assertions**

In `test/integration/execution-ctrl.integration.test.ts`, keep `beforeAll`/`afterAll` (trap deploy + cleanup) and the `ACCOUNT_CLOSURE_REQUESTED` test. Replace the `DECISION_APPROVED` and `USER_CONFIRMED` `it` blocks with:

```typescript
function trade(symbol: string, side: 'BUY' | 'SELL' = 'BUY', quantityOrAmountCents = 50000) {
  return { symbol, assetClass: 'EQUITY', side, quantityOrAmountCents, targetWeightPercent: 50, rationale: 'integ' };
}

it('expands a 2-trade DECISION_APPROVED into 2 per-symbol Order CDC events', async () => {
  const decisionPacketId = `integ-decision-${Date.now()}`;
  await eb.putEvent({
    bus: 'execution',
    targetService: 'execution-ctrl',
    detailType: 'DECISION_APPROVED',
    subject: {
      ccId: `integ-cc-${Date.now()}`,
      decisionPacketId,
      decisionId: `integ-dec-${Date.now()}`,
      taskToken: `fake-task-token-${Date.now()}`,
      mandateSnapshot: { level: 'ADVISORY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-01T00:00:00.000Z' },
      status: 'COMPLETED' as const,
      result: 'APPROVED' as const,
      violations: [],
      authorityLevel: 'L1' as const,
      proposedTrades: [trade('VTI'), trade('BND', 'SELL', 30000)],
      sourceEventId: `integ-src-${Date.now()}`,
    },
  });

  const match = (d: { subject?: { decisionPacketId?: string } }) => d?.subject?.decisionPacketId === decisionPacketId;
  const e1 = await trap.waitForEvent<BusEventPayload>({ match, timeoutMs: 90_000 });
  const e2 = await trap.waitForEvent<BusEventPayload>({ match, timeoutMs: 90_000 });

  for (const e of [e1, e2]) {
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(e.detailType);
    expect(e.detail.subject).toEqual(expect.objectContaining({
      decisionPacketId,
      symbol: expect.any(String),
      side: expect.stringMatching(/^(BUY|SELL)$/),
      quantityOrAmountCents: expect.any(Number),
    }));
  }
  expect([e1, e2].map((e) => (e.detail.subject as { symbol: string }).symbol).sort()).toEqual(['BND', 'VTI']);
}, 120_000);

it('expands a USER_CONFIRMED carrying proposedTrades into a per-symbol Order CDC event', async () => {
  const decisionId = `integ-user-confirmed-${Date.now()}`;
  await eb.putEvent({
    bus: 'execution',
    targetService: 'execution-ctrl',
    detailType: 'USER_CONFIRMED',
    subject: {
      decisionId,
      confirmedAt: new Date().toISOString(),
      confirmedBy: 'integ-test-user',
      timestamp: new Date().toISOString(),
      proposedTrades: [trade('VTI')],
    },
    context: { tenantId: `integ-tenant-${Date.now()}` },
  });

  const event = await trap.waitForEvent<BusEventPayload>({
    match: (d: { subject?: { decisionPacketId?: string } }) => d?.subject?.decisionPacketId === decisionId,
    timeoutMs: 90_000,
  });
  expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
  expect(event.detail.subject).toEqual(expect.objectContaining({ decisionPacketId: decisionId, symbol: 'VTI' }));
}, 120_000);
```

(USER_CONFIRMED maps `subject.decisionId → Order.decisionPacketId`, so the trap matches on `decisionPacketId === decisionId`.)

- [ ] **Step 2: Commit the test (runs at deploy)**

```bash
git add services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts
git commit --no-verify -m "test(execution-ctrl): integration asserts per-trade Order CDC expansion (WS-2)"
```

- [ ] **Step 3: Run after deploy (closing phase 6.4)**

Run (after `deploy.sh ... --services=execution-ctrl`): `pnpm nx run execution-ctrl:test-integration`
Expected: PASS — 2 per-symbol events for DECISION_APPROVED, 1 for USER_CONFIRMED, plus the unchanged ACCOUNT_CLOSURE skip test. Per `feedback-flake-means-broken`: if any case fails-then-passes, pull CloudWatch from the failing window (`/aws/lambda/dev-execution-ctrl-*`) before continuing and run a confirmation pass.

---

### Task 4: Regenerate the execution-ctrl service card

The contract reshape changes the card's "Event Payload Contracts" + "DDB Entities"/handler notes.

**Files:**
- Modify: `services/execution/execution-ctrl/CLAUDE.md`

- [ ] **Step 1: Regenerate via the audit-service skill**

Invoke the `audit-service` skill for `execution-ctrl`; let it regenerate `CLAUDE.md` from code. Confirm the new `OrderSchema`/`StagedOrderSchema` field lists (symbol/side/quantityOrAmountCents) and the removal of `domain/schemas.ts` are reflected; reconcile any drift it surfaces.

- [ ] **Step 2: Commit**

```bash
git add services/execution/execution-ctrl/CLAUDE.md
git commit --no-verify -m "docs(execution-ctrl): regen service card for per-trade Order contracts (WS-2)"
```

---

## Self-Review

**Spec coverage (spec §4 hop 2 + §3 + §7 + §8):**
- Convert `OrderSchema.proposedTrades` z.unknown()→typed `ProposedTrade[]` read off the authorizing event → Task 2 Step 1 + Step 5. ✔
- Expand to N `Order` rows, one per trade, each carrying `symbol/side/quantityOrAmountCents` → Task 2 Step 5. ✔
- Emit N `ORDER_SUBMITTED`, DRY subject (identity in context) → `record()` puts `pickRequestContext(ctx)` + subject fields; subject has no identity. ✔
- Preserve per-order SUBMITTED/STAGED/REJECTED branching → Task 2 Step 5 (`orderRow` + market/safety branches). ✔
- Idempotency keyed on per-trade orderId → `` `${authorizingEventId}#${index}` `` + `record()` `attribute_not_exists(pk)` (Global Constraints; Task 2 Interfaces). ✔
- §3 amount denomination — carry `quantityOrAmountCents`, defer amount→shares to WS-3 → Global Constraints + "Not touched". ✔
- §8 double-trigger guard — operating-mode authority keeps DECISION_APPROVED/USER_CONFIRMED mutually exclusive (upstream, unchanged); per-trade orderId is idempotent on redelivery → not a new code path here. ✔ (out of scope, noted in backlog frontmatter.)
- §8 read-model ownership — Order/StagedOrder stay CommandOwned, enforced → Task 2 Step 10. ✔

**Placeholder scan:** every code step shows full code; no TBD/“handle errors”/“similar to”. Commands have expected output. ✔

**Type consistency:** `ApprovedDecision` uses `authorizingEventId` (Task 1 call site uses `proposedTrades.map(t=>t.symbol)`; Task 2 switches to per-trade `[t.symbol]`). `Order`/`StagedOrder` field names match between `contracts.ts` (Task 2 Step 1), the handler (`orderRow`/`stagedSubject`, Step 5), the repository (`order['symbol']`, Step 6), and the staged processor (`staged['symbol']`, Step 7). `runAllChecks(tenantId, instruments: string[])` is consistent across Task 1 (signature) and Task 2 (callers). ✔

## Execution Handoff

(Filled at handoff — see chat.)
