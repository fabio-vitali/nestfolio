# WS-5 real-path e2e + integration + flow-spec sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Make the accept-decision e2e drive the **real** order→fill→ledger path (not synthetic ledger-bus injection), proving the money path works end-to-end; keep the flow specs in sync.

**Architecture:** WS-1..WS-4 repaired every hop. The e2e's TRIGGER 2 currently injects a synthetic `ORDER_FILLED` on the ledger bus. Replace it with a real `ORDER_SUBMITTED` on the **execution** bus targeted at broker-ctrl → OrderStateMachine (reads `$.context`/`$.subject`) → RouteOrder → broker-sim-adpt (amountCents→shares fill) → `ORDER_FILLED` (carries symbol/side) → ledger-adpt → ledger-ctrl RecordFill → `getPortfolio` reflects VTI.

**Tech Stack:** `@nestfolio/test-support` EventBridgeClient, Jest e2e (deployed dev), flow YAML.

## Global Constraints

- E2E asserts via real reads (`getPortfolio` GraphQL). No POM/sleep band-aids for *UI* state. (Backend event-cache seeding sequenced ahead of a multi-second flow is not a UI band-aid.)
- The expensive e2e **run** is batched at epic E6 (orchestrator). WS-5 authors the test; the per-member gate is execution-ctrl integration (already green from WS-2) + build/lint.
- Worktree commits `--no-verify`, verify landed.

## Key facts (from investigation)

- **ExecutionMode is NOT seeded by onboarding** (set by investor-bff `confirmGoLive` in prod). The SF's `ReadExecutionMode` GetItem must find `ExecutionMode#<tenantId>`, else RouteOrder's `$.executionMode.Item.mode.S` path errors. → the e2e seeds it via `EXECUTION_MODE_CHANGED` (targetService `broker-ctrl`), early, so it settles during the confirmation flow.
- **SF trigger `$or` rule** matches non-`integration-test:` sources OR `integration-test:broker-ctrl`. Publishing `ORDER_SUBMITTED` with `targetService:'broker-ctrl'` ⇒ source `integration-test:broker-ctrl` ⇒ **matches** ⇒ SF fires. All downstream events (SIM_ORDER_REQUESTED, SIM_ORDER_FILLED, ORDER_FILLED) are real prod-source PutEvents/CDC and match their prod-source rules.
- **broker-sim-adpt lazy-inits a $100k virtual account** → a $5,000 (500_000-cent) VTI BUY fills.
- **execution-ctrl integration test already covers hops 1-2** (WS-2). No new integration test needed.
- **Flow specs already synced** in this workstream (order-execution.flow.yaml break-A NOTE removed; order-ledger.flow.yaml break-D note replaced with the real RecordFill normalization).

## Files

- Modify: `apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts` — seed ExecutionMode in `beforeEach`; replace TRIGGER 2 (synthetic ledger-bus ORDER_FILLED) with a real execution-bus ORDER_SUBMITTED; drop the stale "broken path / proof of impact" comment.
- (Done) `flows/order-execution.flow.yaml`, `flows/order-ledger.flow.yaml`.

---

### Task 1: Drive the real order→fill→ledger path in the accept-decision e2e

**Files:** Modify `apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts`.

- [ ] **Step 1: Seed ExecutionMode early.** In `beforeEach`, after `applyFixtures`, emit `EXECUTION_MODE_CHANGED` (sim) targeted at broker-ctrl so the cache settles before the order:

```ts
// Seed broker-ctrl's ExecutionMode cache (simulation) for this tenant. In prod investor-bff
// confirmGoLive sets it; onboarding does not. Emitted here (early) so the EXECUTION_MODE_CHANGED →
// mode-listener → DDB write settles well before TRIGGER 2's ORDER_SUBMITTED reaches the order SF.
const ebSeed = new EventBridgeClient(ctx);
await ebSeed.putEvent({
  bus: 'execution',
  targetService: 'broker-ctrl',
  detailType: 'EXECUTION_MODE_CHANGED',
  subject: { changeId: `e2e-mode-${tenant.tenantId}`, fromMode: 'simulation', toMode: 'simulation', changedAt: new Date().toISOString() },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```

- [ ] **Step 2: Replace TRIGGER 2** (the synthetic ledger-bus `ORDER_FILLED` block + its stale comment) with a real execution-bus `ORDER_SUBMITTED` targeted at broker-ctrl:

```ts
// TRIGGER 2: drive the REAL order→fill→ledger path (order-execution-money-path).
// ORDER_SUBMITTED on the execution bus targeted at broker-ctrl (source integration-test:broker-ctrl
// matches the OrderStateMachine trigger $or rule). The SF reads $.context/$.subject, routes to the
// sim, which converts amountCents→shares and fills; ORDER_FILLED carries symbol/side; ledger-ctrl
// records real economics → getPortfolio reflects the VTI position.
await eb.putEvent({
  bus: 'execution',
  targetService: 'broker-ctrl',
  detailType: 'ORDER_SUBMITTED',
  subject: {
    orderId: `e2e-order-${Date.now()}`,
    symbol: 'VTI',
    side: 'BUY',
    quantityOrAmountCents: 500_000,
    status: 'SUBMITTED',
  },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```

  The existing `getPortfolio` poll (VTI quantity > 0, 120s) and the CONFIRMED assertion are unchanged — they now validate the real path.

- [ ] **Step 3: Build/lint check.** `pnpm nx run e2e-feature-tests:lint` (and typecheck if defined) green. The e2e RUN is batched at E6.
- [ ] **Step 4: Commit** — `git commit --no-verify -m "test(e2e): drive the real order→fill→ledger path in accept-decision (WS-5)"`; verify landed.

---

### Task 2: Confirm execution-ctrl integration coverage + flow sync (verification only)

- [ ] **Step 1** — confirm `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts` already asserts DECISION_APPROVED/USER_CONFIRMED→per-trade ORDER_SUBMITTED with symbol/side/quantityOrAmountCents (WS-2). No new test unless a gap is found.
- [ ] **Step 2** — `validate-flow` (or visual) check that `flows/order-execution.flow.yaml` + `flows/order-ledger.flow.yaml` match the shipped code (NOTEs dropped, RecordFill normalization described).
- [ ] **Step 3** — true-affected `test,lint` green; e2e-feature-tests + execution-ctrl integration green (the latter run at the per-member gate; the e2e at E6).

## Out of scope

- Playwright full-journey assertion (market-hours dependent) — E6 runs the touched journeys; not a new assertion here.
- broker-sim-adpt SIM_ORDER_REJECTED emission (captured member) — the e2e drives a funded BUY that fills.

## Self-review

- Spec §5 e2e (real ORDER_SUBMITTED → broker SF → sim fill → ORDER_FILLED → ledger → getPortfolio) → Task 1. ✓
- Spec §5 execution-ctrl integration (hops 1-2) → already covered by WS-2. ✓
- Flow-spec sync → done in this workstream. ✓
- ExecutionMode seeding + source-filter match are handled without code/test-support changes. ✓
