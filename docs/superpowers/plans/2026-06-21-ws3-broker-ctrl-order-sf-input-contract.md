# WS-3 broker-ctrl order-SF input-contract + fill-economics repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make broker-ctrl's OrderStateMachine route + fill + normalize a real `ORDER_SUBMITTED` end-to-end on the simulation path, so `ORDER_FILLED` carries real `symbol/side/filledQty/averageFillPrice`.

**Architecture:** Fix the SF ASL JSONPath to the standard `{subject, context}` envelope (break A); enrich `NormalizedOrderEventSchema` + the SF `PutItem`s with `symbol/side` (break D producer); carry the dollar **amount** on the order request and have broker-sim-adpt convert amount→shares at its known fill price (denomination, user-approved Option 1); fix callback-resolver to read the sim's actual fill field names (latent bug exposed once break A lets orders reach the adapter).

**Tech Stack:** AWS CDK (`aws-stepfunctions` `CustomState` ASL), DynamoDB, EventBridge, zod, `@nestfolio/event-processor`, Jest.

## Global Constraints

- Tests live in `test/` (`test/unit/`, `test/integration/`), NEVER `src/__tests__/`. (CLAUDE.md)
- All Lambda handlers use event-processor pipelines — no raw handlers. (CLAUDE.md)
- DRY subjects: identity (`tenantId/userId/region`) travels in the event **context**, not the subject. (broker-ctrl card)
- Run tasks through `pnpm nx`, never the underlying tool. Worktree commits use `git commit --no-verify` and must be verified to have landed. (worktree memory)
- `NormalizedEvent` is NOT a governed read model (not in `ReadModelOwnership`, not in `read-model-exclusions.json`) — adding producer fields does NOT trip the `read-model-drift` gate.
- Standard envelope on a CDC event: `detail = { id, type, timestamp, subject:{…}, context:{ tenantId, userId, region } }`. The Orchestration construct wires the SF target with `RuleTargetInput.fromEventPath('$.detail')`, so SF input `$` == `detail` (i.e. `$.subject.*`, `$.context.*`).
- Post-WS-2 `ORDER_SUBMITTED.subject` = `{ orderId, decisionPacketId, symbol, side, quantityOrAmountCents, status, reason?, sourceEventId?, timestamp }`; `quantityOrAmountCents` is a **dollar amount in cents**.

---

## File map

- `services/execution/broker-ctrl/src/domain/contracts.ts` — `NormalizedOrderEventSchema` (+symbol/side), `BrokerOrderSchema` (requestedQty→requestedAmountCents, drop remainingQty), `BrokerOrderRequestSchema` (quantity→amountCents).
- `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts` — all break-A JSONPath + break-D symbol/side writes + RouteOrder/WaitForMoreFills payload reshape.
- `services/execution/broker-ctrl/src/handlers/route-order.ts` — consume reshaped flat `order`, carry `amountCents`, emit request subject with `amountCents`.
- `services/execution/broker-ctrl/src/handlers/callback-resolver.ts` — map sim fill fields (`quantity`→filledQty, `fillPrice`→averageFillPrice).
- `services/execution/broker-ctrl/src/repositories/broker-order.repository.ts` — `CreateOrderParams`/`createOrder` denomination.
- `services/execution/broker-sim-adpt/src/handlers/event-listener.ts` — read `amountCents` from the request subject.
- `services/execution/broker-sim-adpt/src/services/simulation-engine.service.ts` — convert amount→shares at fill price.
- `libs/test-contracts/` (fixtures) — ORDER_* fixtures gain symbol/side (driven by the schema change; fix whatever `check-typed-fixtures` reports).
- Tests: `broker-ctrl/test/unit/{domain/contracts,service.stack,route-order,callback-resolver,broker-order.repository,order-lifecycle}.test.ts`, `broker-sim-adpt/test/{simulation-engine.service,event-listener}.test.ts`.

---

### Task 1: `NormalizedOrderEventSchema` gains `symbol` + `side` (break D producer — contract)

**Files:**
- Modify: `services/execution/broker-ctrl/src/domain/contracts.ts:14-22`
- Test: `services/execution/broker-ctrl/test/unit/domain/contracts.test.ts`

**Interfaces:**
- Produces: `NormalizedOrderEventSchema` now requires `symbol: string`, `side: 'BUY'|'SELL'` (in addition to existing `orderId, executionMode, filledQty?, averageFillPrice?, failureReason?, timestamp`). Consumed by WS-4 (ledger) + the SF PutItems (Task 2) + typed fixtures (Task 6).

**Decision (auto-resolved, logged):** `symbol`/`side` are **required** (not optional). All ORDER_* NormalizedEvent emissions (FILLED/REJECTED/ESCALATED) have `$.subject` threaded, so they can always write them — required gives WS-4 a clean non-optional read and is the most consistent/reusable contract.

- [ ] **Step 1: Write the failing test** — in `contracts.test.ts`, add a describe for `NormalizedOrderEventSchema`:

```ts
import { NormalizedOrderEventSchema } from '../../../src/domain/contracts';

describe('NormalizedOrderEventSchema', () => {
  const base = { orderId: 'o1', executionMode: 'simulation', symbol: 'VTI', side: 'BUY', timestamp: '2026-06-21T00:00:00Z' };
  it('requires symbol and side', () => {
    expect(NormalizedOrderEventSchema.safeParse(base).success).toBe(true);
    expect(NormalizedOrderEventSchema.safeParse({ ...base, symbol: undefined }).success).toBe(false);
    expect(NormalizedOrderEventSchema.safeParse({ ...base, side: undefined }).success).toBe(false);
  });
  it('rejects an invalid side', () => {
    expect(NormalizedOrderEventSchema.safeParse({ ...base, side: 'HOLD' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `pnpm nx test broker-ctrl -- --testPathPatterns contracts.test` → FAIL (symbol/side not in schema).
- [ ] **Step 3: Implement** — add to `NormalizedOrderEventSchema` after `orderId`:

```ts
export const NormalizedOrderEventSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  executionMode: z.enum(['simulation', 'live']),
  filledQty: z.number().optional(),
  averageFillPrice: z.number().optional(),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
```

- [ ] **Step 4: Run, verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit --no-verify -m "feat(broker-ctrl): NormalizedOrderEventSchema carries symbol/side (WS-3 break D producer)"` then `git log --oneline -1` to confirm.

---

### Task 2: SF ASL — break A JSONPath fix + break D symbol/side writes

**Files:**
- Modify: `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts`
- Test: `services/execution/broker-ctrl/test/unit/service.stack.test.ts`

**Interfaces:**
- Consumes: SF input `$` = `{ subject:{ orderId, symbol, side, quantityOrAmountCents, … }, context:{ tenantId, userId, region } }`.
- Produces: `RouteOrder`/`WaitForMoreFills` Lambda payload `order` = flat `{ tenantId, orderId, userId, symbol, side, amountCents }` (consumed by Task 3's `route-order.ts`). NormalizedEvent rows now include `symbol`/`side`.

**The exhaustive JSONPath rewrite** (every occurrence):
- `$.tenantId` → `$.context.tenantId`; `$.userId` → `$.context.userId`; `$.region` → `$.context.region`; `$.orderId` → `$.subject.orderId`.
- `ReadExecutionMode` key: `States.Format('ExecutionMode#{}', $.context.tenantId)`.
- `RouteOrder` + `WaitForMoreFills` `Payload.order` — replace `'order.$': '$'` with the explicit flat object:

```ts
'order': {
  'tenantId.$': '$.context.tenantId',
  'orderId.$': '$.subject.orderId',
  'userId.$': '$.context.userId',
  'symbol.$': '$.subject.symbol',
  'side.$': '$.subject.side',
  'amountCents.$': '$.subject.quantityOrAmountCents',
},
'executionMode.$': '$.executionMode.Item.mode.S',
'taskToken.$': '$$.Task.Token',
```

- `MarkFilledUpdateOrder`, `MarkPartialFill`, `MarkRejectedUpdateOrder`, `HandleTimeoutEscalateOrder` keys: `States.Format('BrokerOrder#{}#{}', $.context.tenantId, $.subject.orderId)`.
- `MarkFilledNormalizedEvent`, `MarkRejectedNormalizedEvent`, `HandleTimeoutNormalizedEvent` `Item`: pk `States.Format('NormalizedEvent#{}#{}', $.context.tenantId, $.subject.orderId)`; `tenantId←$.context.tenantId`, `userId←$.context.userId`, `region←$.context.region`, `orderId←$.subject.orderId`; **add** `symbol: { 'S.$': '$.subject.symbol' }`, `side: { 'S.$': '$.subject.side' }`.

- [ ] **Step 1: Write the failing test** — add to `service.stack.test.ts` (it already extracts the joined `DefinitionString` into `orderSM`; factor that into a `beforeAll`-scoped string or recompute inline):

```ts
it('order SF reads identity from $.context and order data from $.subject (break A)', () => {
  const sms = template.findResources('AWS::StepFunctions::StateMachine');
  const def = Object.values(sms).map((sm: any) => sm.Properties.DefinitionString['Fn::Join'][1].join('')).find((d: string) => d.includes('ReadExecutionMode'))!;
  expect(def).toContain("ExecutionMode#{}', $.context.tenantId");
  expect(def).toContain('$.subject.orderId');
  expect(def).toContain('$.subject.symbol');
  expect(def).toContain('$.subject.side');
  // the broken flat reads are gone
  expect(def).not.toContain("ExecutionMode#{}', $.tenantId");
  expect(def).not.toContain("'order.$': \"$\"");
});
it('MarkFilled NormalizedEvent writes symbol and side (break D producer)', () => {
  const sms = template.findResources('AWS::StepFunctions::StateMachine');
  const def = Object.values(sms).map((sm: any) => sm.Properties.DefinitionString['Fn::Join'][1].join('')).find((d: string) => d.includes('MarkFilledNormalizedEvent'))!;
  // symbol/side keys appear in the PutItem Item
  expect(def).toContain('"symbol"');
  expect(def).toContain('"side"');
});
```

(If the exact rendered-string assertions are brittle against CDK's JSON encoding, assert on `JSON.parse` of the resolved definition instead — but the join-string `includes` approach matches the existing test at line 38.)

- [ ] **Step 2: Run, verify it fails** — `pnpm nx test broker-ctrl -- --testPathPatterns service.stack` → FAIL.
- [ ] **Step 3: Implement** — apply the exhaustive rewrite above across all states in `order-state-machine.ts`.
- [ ] **Step 4: Run, verify pass** — same command → PASS. Also `pnpm nx run broker-ctrl:lint` clean.
- [ ] **Step 5: Commit** — `git commit --no-verify -m "fix(broker-ctrl): order SF reads $.context/$.subject envelope + writes symbol/side (WS-3 break A + D producer)"`; verify landed.

---

### Task 3: route-order + BrokerOrder denomination (request carries `amountCents`)

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/route-order.ts`, `services/execution/broker-ctrl/src/domain/contracts.ts` (`BrokerOrderSchema`, `BrokerOrderRequestSchema`), `services/execution/broker-ctrl/src/repositories/broker-order.repository.ts`
- Test: `services/execution/broker-ctrl/test/unit/route-order.test.ts`, `broker-order.repository.test.ts`, `domain/contracts.test.ts`

**Interfaces:**
- Consumes: `order` payload `{ tenantId, orderId, userId, symbol, side, amountCents }` (from Task 2).
- Produces: `SIM_ORDER_REQUESTED`/`ALPACA_ORDER_REQUESTED` subject `{ orderId, userId, symbol, side, amountCents }` (consumed by Task 5's sim event-listener). `BrokerOrder` row carries `requestedAmountCents` (no `remainingQty`).

Changes:
- `RouteOrderEvent.order`: rename `quantity: number` → `amountCents: number`.
- `route-order.ts`: `repo.createOrder({ …, requestedAmountCents: order.amountCents, instrumentId: order.symbol, … })`; emitted `subject` field `quantity: order.quantity` → `amountCents: order.amountCents`.
- `BrokerOrderRequestSchema`: `quantity: z.number()` → `amountCents: z.number()`.
- `BrokerOrderSchema`: `requestedQty` → `requestedAmountCents`; **remove** `remainingQty` (write-only audit field, no production reader; shares-remaining is meaningless under amount-denomination; alpaca partial-fill is out of epic scope).
- `CreateOrderParams`/`createOrder`: `requestedQty` → `requestedAmountCents`; drop the `remainingQty: params.requestedQty` line.

- [ ] **Step 1: Write/adjust failing tests** — in `route-order.test.ts`, drive `handler` with `order: { tenantId, orderId, userId, symbol:'VTI', side:'BUY', amountCents: 50000 }` and assert the emitted detail subject has `amountCents: 50000` and `createOrder` was called with `requestedAmountCents: 50000`. Update `broker-order.repository.test.ts` + `contracts.test.ts` BrokerOrder fixtures to `requestedAmountCents` and remove `remainingQty`.
- [ ] **Step 2: Run, verify fail** — `pnpm nx test broker-ctrl -- --testPathPatterns "(route-order|broker-order.repository|contracts)"` → FAIL.
- [ ] **Step 3: Implement** the renames above.
- [ ] **Step 4: Run, verify pass** — same → PASS; `pnpm nx run broker-ctrl:lint` clean.
- [ ] **Step 5: Commit** — `git commit --no-verify -m "refactor(broker-ctrl): order request carries amountCents (WS-3 denomination, request side)"`; verify landed.

---

### Task 4: callback-resolver maps the sim's actual fill fields

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/callback-resolver.ts:55-66`
- Test: `services/execution/broker-ctrl/test/unit/callback-resolver.test.ts`

**Context:** `SIM_ORDER_FILLED.subject` is a `VirtualTrade` with `quantity` + `fillPrice`; the alpaca path uses `filledQuantity` + `averageFillPrice` + `rejectionReason`. The current code reads only the alpaca names → `filledQty`/`averageFillPrice` come back `undefined` for sim fills.

- [ ] **Step 1: Write the failing test** — assert that for `SIM_ORDER_FILLED` with subject `{ orderId, quantity: 2.5, fillPrice: 200 }`, the `SendTaskSuccessCommand` output JSON has `filledQty: 2.5, averageFillPrice: 200`; and the existing alpaca case (`filledQuantity`/`averageFillPrice`) still maps. (Mock `SFNClient`/`repo.getTaskToken` per the existing test's pattern.)
- [ ] **Step 2: Run, verify fail** — `pnpm nx test broker-ctrl -- --testPathPatterns callback-resolver` → FAIL (sim → undefined).
- [ ] **Step 3: Implement** — source-aware extraction in `resolveCallback`:

```ts
const isSim = ctx.eventType.startsWith('SIM_');
const filledQty = isSim ? payload.subject.quantity : payload.subject.filledQuantity;
const averageFillPrice = isSim ? payload.subject.fillPrice : payload.subject.averageFillPrice;
const failureReason = (payload.subject.rejectionReason ?? payload.subject.rejectReason) as string | undefined;
await sfn.send(new SendTaskSuccessCommand({
  taskToken,
  output: JSON.stringify({ status: mapEventToStatus(ctx.eventType), filledQty, averageFillPrice, failureClass, failureReason }),
}));
```

- [ ] **Step 4: Run, verify pass** — same → PASS.
- [ ] **Step 5: Commit** — `git commit --no-verify -m "fix(broker-ctrl): callback-resolver maps sim fill quantity/fillPrice (WS-3 fill economics)"`; verify landed.

---

### Task 5: broker-sim-adpt converts amount→shares at fill price (denomination, adapter side)

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/handlers/event-listener.ts:19-53`, `services/execution/broker-sim-adpt/src/services/simulation-engine.service.ts:23-90`
- Test: `services/execution/broker-sim-adpt/test/simulation-engine.service.test.ts`, `event-listener.test.ts`

**Interfaces:**
- Consumes: `SIM_ORDER_REQUESTED.subject` `{ orderId, symbol, side, amountCents }` (from Task 3).
- Produces: `VirtualTrade` (`SIM_ORDER_FILLED`) with `quantity` = derived fractional shares, `fillPrice` = market price (consumed by Task 4).

**Design:** the request expresses a **dollar amount**; the engine holds the price, so it converts: `shares = (amountCents / 100) / fillPrice` (fractional, Alpaca-notional style). The engine signature changes `quantity` → `amountCents`; it fetches the price first, derives shares, then runs the existing cash/position checks against the derived shares.

- [ ] **Step 1: Write the failing test** — in `simulation-engine.service.test.ts`, add: given `marketData.getPrice` returns `200` and `processOrderSubmitted(orderId, 'VTI', 'BUY', /*amountCents*/ 50000, ctx)`, assert `executeTrade` is called with `quantity === 2.5` (= $500 / $200) and the FillResult `fillQuantity === 2.5`. (Match the file's existing mock setup for `repository`/`marketData`.)
- [ ] **Step 2: Run, verify fail** — `pnpm nx test broker-sim-adpt -- --testPathPatterns simulation-engine` → FAIL (treats 50000 as shares).
- [ ] **Step 3: Implement** —
  - `simulation-engine.service.ts`: rename the param `quantity` → `amountCents`; after fetching `fillPrice`, compute `const quantity = (amountCents / 100) / fillPrice;` then keep the rest (`totalValue = quantity * fillPrice` ≈ `amountCents/100`, cash/position checks, `executeTrade`, FillResult). Validate `amountCents > 0` instead of `quantity`.
  - `event-listener.ts`: read `const amountCents = subject.amountCents as number;` (replace the `quantity` read + the missing-field guard message), pass `amountCents` to `processOrderSubmitted`.
- [ ] **Step 4: Run, verify pass** — `pnpm nx test broker-sim-adpt -- --testPathPatterns "(simulation-engine|event-listener)"` → PASS; `pnpm nx run broker-sim-adpt:lint` clean.
- [ ] **Step 5: Commit** — `git commit --no-verify -m "feat(broker-sim-adpt): convert order amountCents to shares at fill price (WS-3 denomination, adapter side)"`; verify landed.

---

### Task 6: typed fixtures + cross-cutting verification

**Files:**
- Modify (as the gate reports): `libs/test-contracts/` ORDER_* fixtures (add `symbol`/`side`).
- Verify: typecheck, `check-typed-fixtures`, `read-model-drift`, true-affected `test,lint`.

- [ ] **Step 1: Run the typed-fixtures gate** — find and run it (`grep -rn check-typed-fixtures tools .claude package.json`, then the nx target). Expected: FAIL — ORDER_* fixtures missing required `symbol`/`side`.
- [ ] **Step 2: Add `symbol`/`side`** to every ORDER_FILLED / ORDER_PARTIALLY_FILLED / ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED fixture the gate flags.
- [ ] **Step 3: Re-run the gate** → PASS.
- [ ] **Step 4: Read-model-drift + typecheck** — `pnpm nx run broker-ctrl:typecheck` and the `event-processor:read-model-drift` target → PASS (NormalizedEvent is not governed; expect no new registration).
- [ ] **Step 5: Commit** — `git commit --no-verify -m "test(contracts): ORDER_* typed fixtures carry symbol/side (WS-3)"`; verify landed.

---

## Out of scope (file via backlog-add, do not implement here)

- **broker-sim-adpt never emits `SIM_ORDER_REJECTED`** — the engine returns `{status:'REJECTED'}` but `event-listener` only logs it (no event, no row), so a rejected sim order escalates via the 1-hour SF timeout instead of a clean `ORDER_REJECTED`. Orthogonal to the epic's happy-path `done_when` (a funded $X buy fills). File as an epic finding.
- broker-alpaca-adpt amount→shares (live path) — live e2e is out of the epic.

## Self-review

- **Break A** → Task 2 (all states). **Break D producer** → Task 1 (schema) + Task 2 (PutItems) + Task 6 (fixtures). **Denomination** → Task 3 (request) + Task 5 (adapter convert). **Fill economics** → Task 4. ✓ all spec hops 3 + 6 covered for the sim path.
- Type consistency: `amountCents` is the request denomination across Task 2 payload → Task 3 route-order/`BrokerOrderRequestSchema` → Task 5 sim. `quantity`(shares)/`fillPrice` are the sim fill fields read by Task 4 and mapped to `filledQty`/`averageFillPrice` (the NormalizedEvent/`NormalizedOrderEventSchema` names). ✓
- No placeholders. Every code step shows the change. ✓
