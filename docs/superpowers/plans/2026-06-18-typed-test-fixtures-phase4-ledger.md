# Typed Test Fixtures — Phase 4 (Ledger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit the LEDGER domain's producer events to the typed `putEvent({ detailType, subject, context })` API so a co-wrong ledger fixture becomes a compile error — the final (4th) domain wave, after which the untyped-`putEvent` gate is workspace-wide and the `typed-test-fixtures` epic is shippable.

**Architecture:** The two ledger producers (`ledger-ctrl`, `reconciliation-ctrl`) each already own their zod subject schemas in `src/domain/contracts.ts`. This phase appends an `<svc>EventSubjects` map (event detailType → producer subject schema) to each, composes them into the single `EventSubjects` registry in `libs/test-contracts/src/index.ts`, registers the 5 ledger event names, and migrates every fixture that injects them. Because the gate (`tools/check-typed-fixtures.mjs`) is **global + name-driven**, registering a ledger-produced event flags that event's fixtures in **every** domain — so this is the ledger *producer wave*: it migrates the cross-domain consumer fixtures (investor-bff, dashboard-bff, decision-workflow-ctrl, the shared e2e `funded()` helper) that inject ledger events, not just `services/ledger/**`.

**Tech Stack:** TypeScript, zod, Nx, Jest, `@nestfolio/test-contracts` + `@nestfolio/test-support`, pure-Node gate script.

## Global Constraints

- **Test layer only — NO production code changes.** Appending a producer's `<svc>EventSubjects` map to its `src/domain/contracts.ts` is permitted: that export is consumed only by `@nestfolio/test-contracts`. Do NOT change any producer emission, consumer (`parseSubject`), CDK stack, handler, or production schema. (spec §2 non-goals, §9.)
- **Identity lives in `context`, never in the subject.** A per-test `tenantId`/`userId`/`region` moves out of the payload into `context: { … }`. An identity field left in a `subject:` is an excess-property compile error (the point). The producer schemas (`BalanceUpdatedSchema`/`PortfolioUpdatedSchema`/`LedgerEntryRecordedSchema`/`ReconciliationResultSchema`/`DriftRecordSchema`) are all DRY (no identity).
- **Static-only validation gate (this phase).** Ship on: `check-typed-fixtures.mjs` prints `OK` + per-touched-project `tsc --noEmit` shows **no NEW errors** (pre-existing latent errors are tolerated — see `investor-services-latent-tsc-errors`, `broker-alpaca-adpt-latent-tsc-errors`) + `test-contracts` unit green + `lint` clean — all run with `--skip-nx-cache` for fixture-touching projects (spec §5 CORRECTION: the nx cache masks the test-only circular-dependency rule). The deployed-dev integration/e2e run is **decoupled** to the `typed-test-fixtures-consolidated-integration-e2e-verify` member (program decision 2026-06-17); do NOT deploy or run integration/e2e suites in this phase.
- **Scope (decided 2026-06-18, full producer-wave).** Register the 5 ledger-PRODUCED events and migrate every fixture that injects them, wherever it lives (ledger + investor + advisory + the e2e `funded()` helper). DO NOT register the EXECUTION events that ledger *consumes* (`ORDER_*`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED`, `ALPACA_ACCOUNT_SNAPSHOT`, `CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`) — those stay deferred under the captured `typed-test-fixtures-execution-deferred-cross-domain` member (user decision: keep as-is, revisit at epic ship). Their `putEvent({ detail })` call-sites remain on the legacy overload (gate-invisible because unregistered).
- **Worktree commits use `--no-verify`** (the pre-commit hook can't run `nx affected` in a worktree) and each commit must be verified to have landed. Commit message suffix:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Registered event names stay alphabetically sorted** in both name-sources and in sync (the `registry.test.ts` sync test enforces it).

---

## Reusable Procedures

Each task references these three procedures verbatim (copied from the Phase 3 plan; the only Phase-4 change is the producer paths and the static-gate "no-NEW-errors" tolerance).

### Procedure REG — register a producer's event→schema map

1. In the producer's `src/domain/contracts.ts`, ensure the top imports include `import { z, type ZodTypeAny } from 'zod';` (the file currently has `import { z } from 'zod';` — widen it; do NOT add a second `import` line).
2. Append (or extend) the `export const <svc>EventSubjects = { … } as const satisfies Record<string, ZodTypeAny>;` map at the END of the file, after the schemas it references (with the doc-comment shown in the task).
3. In `libs/test-contracts/src/index.ts`: add `import { <svc>EventSubjects } from '@nestfolio/<svc>/contracts';` (once per producer) and add `...<svc>EventSubjects,` to the `EventSubjects` object literal (once per producer).
4. Add each new event name (alphabetically) to BOTH name-sources:
   - `tools/typed-fixture-registered-events.json` → `registeredEvents` array.
   - `libs/test-contracts/test/registry.test.ts` → `EXPECTED` array.
5. Run the registry sync test: `pnpm nx test test-contracts --skip-nx-cache` — it pins `Object.keys(EventSubjects).sort()` to `EXPECTED` and asserts the JSON is in sync. Must pass before migrating call-sites.

### Procedure MIG — migrate a `putEvent` call-site

1. Rename the object key `detail:` → `subject:`.
2. Delete every identity field (`tenantId`, `userId`, `region`) from the payload and re-pass them in a `context: { … }` param.
3. Let `tsc --noEmit` surface remaining mismatches and classify each:
   - **(a) fixture-only wrong** — fix the fixture to satisfy the producer schema (remove excess fields, add missing required fields, correct a wrong-typed shape).
   - **(b) latent contract bug** — only if matching the producer schema is impossible because the real producer/consumer actually disagree. File via `backlog-add` (Task 5) and leave the fixture matching the REAL producer.
4. Unregistered events (the deferred execution set) stay on the legacy `putEvent({ detail })` overload — do NOT touch them.

### Procedure VERIFY — per-task gate

Run in order; all must pass before committing the task:
1. `pnpm nx test test-contracts --skip-nx-cache`
2. `npx tsc --noEmit -p <tsconfig>` for each producer/service/app whose test files changed this task (capture the error count and compare to the pre-task baseline — **zero NEW errors**; pre-existing latent errors are tolerated).
3. `node tools/check-typed-fixtures.mjs` → must print `OK (… registered events)` with zero violations.
4. `pnpm nx lint <proj> --skip-nx-cache` for each touched project.

---

## Registration reference

**4 new event names** (alphabetical, inserted into `tools/typed-fixture-registered-events.json` + `registry.test.ts` `EXPECTED`):

| Event | Schema | Producer map (home) | Inserted between |
|---|---|---|---|
| `BALANCE_UPDATED` | `BalanceUpdatedSchema` | `ledgerCtrlEventSubjects` | after `ALPHA_VANTAGE_NEWS_UPDATED`, before `CONSTRUCT_PORTFOLIO` |
| `LEDGER_ENTRY_RECORDED` | `LedgerEntryRecordedSchema` | `ledgerCtrlEventSubjects` | after `INVESTOR_PROFILE_UPDATED`, before `MANDATE_ISSUED` |
| `PORTFOLIO_UPDATED` | `PortfolioUpdatedSchema` | `ledgerCtrlEventSubjects` | after `PORTFOLIO_FAILED`, before `RECOMMENDATION_PROPOSED` |
| `RECONCILIATION_COMPLETED` | `ReconciliationResultSchema` | `reconciliationCtrlEventSubjects` | after `RECOMMENDATION_PROPOSED`, before `SEC_10K_UPDATED` |

**`libs/test-contracts/src/index.ts`** gains two imports + two spreads:
```ts
import { ledgerCtrlEventSubjects } from '@nestfolio/ledger-ctrl/contracts';
import { reconciliationCtrlEventSubjects } from '@nestfolio/reconciliation-ctrl/contracts';
// …
export const EventSubjects = {
  // … existing spreads …
  ...ledgerCtrlEventSubjects,
  ...reconciliationCtrlEventSubjects,
} as const satisfies Record<string, ZodTypeAny>;
```

**`PORTFOLIO_DRIFT_DETECTED` is DELIBERATELY NOT registered (deferred — name collision).** reconciliation-ctrl *produces* it with `DriftRecordSchema` `{ reconciliationId, instrument, intentQty, settlementQty, drift }` (settlement drift, ledger bus), but the decision-workflow-ctrl + advisory-e2e consumer fixtures inject a DIFFERENT *weight-drift* shape `{ portfolioId, driftPercentage, driftDirection, detectedAt }` (advisory bus) for the rebalance-trigger path — a shape **no real producer emits today** (the `weight-drift-detector` is unbuilt; see the `weight-drift-rebalance` epic). One detailType, two incompatible producer intents → the flat `detailType → schema` registry cannot hold both (the exact `ORDER_REJECTED` collision Phase 3 deferred). Registering it to `DriftRecordSchema` would make the dwc/e2e weight-drift fixtures un-correctable-to-green. Task 5 files this as a deferral (cross-ref `weight-drift-rebalance` + the Phase-3 collision note). Its `putEvent({ detail })` sites (dwc integration L245; `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` L61; `…/reconciliation-correction.e2e.test.ts` L75) stay legacy (gate-invisible).

**Not registered (deferred execution set, stays legacy — user Option 1):** `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED`, `ALPACA_ACCOUNT_SNAPSHOT`, `CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`. (`DECISION_PACKET_CREATED` is already registered + its 3 ledger-ctrl sites already migrated in Phase 2 — no Phase-4 work.)

**No config changes needed:** `tsconfig.base.json` already has the `@nestfolio/ledger-ctrl/contracts` + `@nestfolio/reconciliation-ctrl/contracts` paths; `apps/e2e-feature-tests/jest.config.js` already maps both (L30–31); `test-contracts` resolves all producer `/contracts` via its preset. (If a `tsc`/jest resolution failure surfaces, re-confirm these — but Phase 3 left them green.)

> All line numbers below are from `origin/main` at plan time; re-confirm by reading the file before editing (a prior task's edits shift later lines within the same file). Because the gate is global, **each task registers ONE event and migrates ALL of that event's `putEvent({ detail })` sites repo-wide** so the gate is green at the task's commit.

---

### Task 1: `BALANCE_UPDATED` — register (start `ledgerCtrlEventSubjects`) + migrate all sites

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/contracts.ts` (widen zod import + start the map)
- Modify: `libs/test-contracts/src/index.ts` (import + spread `ledgerCtrlEventSubjects`)
- Modify: `tools/typed-fixture-registered-events.json` (+`BALANCE_UPDATED`)
- Modify: `libs/test-contracts/test/registry.test.ts` (+`BALANCE_UPDATED` in `EXPECTED`)
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`

**Interfaces:**
- Produces: `ledgerCtrlEventSubjects` (from `@nestfolio/ledger-ctrl/contracts`), this task registering `BALANCE_UPDATED: BalanceUpdatedSchema`. Tasks 2–3 extend the same map.

- [ ] **Step 1: Apply Procedure REG.** In `services/ledger/ledger-ctrl/src/domain/contracts.ts`, change the first line `import { z } from 'zod';` → `import { z, type ZodTypeAny } from 'zod';`, then append at the END of the file:

```ts
/**
 * Test-fixture event→subject map for ledger-ctrl's CDC emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Grows across Tasks 1–3 (BALANCE_UPDATED, then PORTFOLIO_UPDATED, then LEDGER_ENTRY_RECORDED).
 * Only the primary insert detailTypes are registered (the `*_EVENT_UPDATED` modify variants and the
 * `*_FAILED` error events are not injected by any fixture and use the shared platform error contract).
 */
export const ledgerCtrlEventSubjects = {
  BALANCE_UPDATED: BalanceUpdatedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Then in `libs/test-contracts/src/index.ts` add `import { ledgerCtrlEventSubjects } from '@nestfolio/ledger-ctrl/contracts';` and `...ledgerCtrlEventSubjects,` in the `EventSubjects` literal. Add `BALANCE_UPDATED` (after `ALPHA_VANTAGE_NEWS_UPDATED`, before `CONSTRUCT_PORTFOLIO`) to both `tools/typed-fixture-registered-events.json` and `registry.test.ts` `EXPECTED`.

- [ ] **Step 2: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache` — keys match `EXPECTED`; JSON in sync.

- [ ] **Step 3: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — non-zero exit listing the `BALANCE_UPDATED` `detail:` sites across ledger-bff, investor-bff, dashboard-bff, read-model-projection, and `apps/e2e-feature-tests/src/helpers/fixtures.ts`. This is the Step-4 worklist.

- [ ] **Step 4: Apply Procedure MIG to each flagged `BALANCE_UPDATED` site.** Canonical identity-hoist transform (`ledger-bff.integration.test.ts` L43):

```ts
// BEFORE
await eb.putEvent({
  bus: 'ledger', targetService: 'ledger-bff',
  detailType: 'BALANCE_UPDATED',
  detail: {
    tenantId: ctx.tenantId, userId: ctx.userId,
    cashBalanceCents: 500000,
    deltaCents: 50000,                                  // (a): not in BalanceUpdatedSchema → remove
    snapshot: { positions: {}, cashBalanceCents: 500000, lastEventSequence: 1 },
  },
});
// AFTER
await eb.putEvent({
  bus: 'ledger', targetService: 'ledger-bff',
  detailType: 'BALANCE_UPDATED',
  subject: {
    cashBalanceCents: 500000,
    snapshot: { positions: {}, cashBalanceCents: 500000, lastEventSequence: 1 },
  },
  context: { tenantId: ctx.tenantId, userId: ctx.userId },
});
```

Per-site list (read each before editing — earlier edits shift lines):
  - `ledger-bff.integration.test.ts` **L43** — hoist `tenantId`/`userId`→context; **(a) remove `deltaCents`**.
  - `ledger-bff.integration.test.ts` **L153, L176, L202** — hoist `tenantId`/`userId`→context (no `deltaCents`; pure hoist).
  - `ledger-bff.integration.test.ts` **L253** — hoist `tenantId`/`userId`→context; **(a) remove `deltaCents`** (this one's snapshot has a non-empty positions map — keep it).
  - `investor-bff.integration.test.ts` **L129, L514** — `{ tenantId, userId, cashBalanceCents, snapshot }` → hoist `tenantId`/`userId`→context (no other fields).
  - `dashboard-bff.integration.test.ts` **L250** — `{ cashBalanceCents: 5_000_000, snapshot }`, **no identity** → pure `detail:`→`subject:` rename (no `context`).
  - `read-model-projection.integration.test.ts` **L37–43** — the `publish()` helper passes `detail: snapshotDetail(seq, cash)`. `snapshotDetail` returns `{ cashBalanceCents, snapshot }` which matches `BalanceUpdatedSchema` exactly → change the single key `detail:` → `subject:` in `publish()` (no `context`). Do NOT change `snapshotDetail` (Task 2 reuses it).
  - `apps/e2e-feature-tests/src/helpers/fixtures.ts` **`funded()` helper (~L173–189)** — the local `const detail = { tenantId, userId, cashBalanceCents, snapshot }` already has `snapshot` and is validated by `BalanceUpdatedSchema.parse(detail)`. Rename the const to `subject` WITHOUT identity, keep the explicit parse guard, and pass identity via `context`:

```ts
const subject = {
  cashBalanceCents: opts.cashBalanceCents,
  snapshot: { positions: {}, cashBalanceCents: opts.cashBalanceCents, lastEventSequence: 0 },
};
BalanceUpdatedSchema.parse(subject);                    // explicit guard retained
await eb.putEvent({
  bus: 'investor', targetService: 'investor-bff',
  detailType: LedgerCtrlEventTypes.BALANCE_UPDATED,
  subject,
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```

- [ ] **Step 5: Apply Procedure VERIFY** for the touched projects: `ledger-ctrl`, `test-contracts`, `ledger-bff`, `investor-bff`, `dashboard-bff`, `e2e-feature-tests`. For each `tsc`, compare error count to the pre-task baseline — **zero NEW errors** (investor-bff/dashboard-bff carry pre-existing latent errors per `investor-services-latent-tsc-errors`; tolerate them, fail only on NEW ones in branch-touched files). Gate prints `OK`.

- [ ] **Step 6: Commit.**

```bash
git add services/ledger/ledger-ctrl/src/domain/contracts.ts libs/test-contracts tools/typed-fixture-registered-events.json \
  services/ledger/ledger-bff/test services/investor/investor-bff/test services/investor/dashboard-bff/test \
  apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit --no-verify -m "refactor(ledger-ctrl): register BALANCE_UPDATED subject + migrate ledger/investor BALANCE_UPDATED fixtures (typed-test-fixtures Phase 4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Verify it landed: `git log --oneline -1`.

---

### Task 2: `PORTFOLIO_UPDATED` — extend map + migrate all sites (incl. the reconciliation (a) reshape)

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/contracts.ts` (extend `ledgerCtrlEventSubjects`)
- Modify: `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.integration.test.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

**Interfaces:**
- Consumes: `ledgerCtrlEventSubjects` (Task 1). Extends it with `PORTFOLIO_UPDATED: PortfolioUpdatedSchema`. `index.ts` already spreads the map (Task 1) — no `index.ts` change.

- [ ] **Step 1: Apply Procedure REG (extend).** In `ledger-ctrl/contracts.ts`, add to `ledgerCtrlEventSubjects`:
```ts
  PORTFOLIO_UPDATED: PortfolioUpdatedSchema,
```
Add `PORTFOLIO_UPDATED` (after `PORTFOLIO_FAILED`, before `RECOMMENDATION_PROPOSED`) to the JSON + `EXPECTED`.

- [ ] **Step 2: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 3: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — flags the `PORTFOLIO_UPDATED` `detail:` sites in ledger-bff, reconciliation-ctrl (int+resil), dashboard-bff, read-model-projection, decision-workflow-ctrl.

- [ ] **Step 4: Apply Procedure MIG. Three shapes:**

  **(i) Pure rename** — already `{ positions: <record>, snapshot }` (optionally `streamType`), no identity:
  - `ledger-bff.integration.test.ts` **L72, L273** — `detail:`→`subject:`.
  - `decision-workflow-ctrl.integration.test.ts` **L549, L593** — `{ streamType: 'CASH', positions: { VTI: {…} }, snapshot }` → `detail:`→`subject:`.

  **(ii) (a) reconciliation reshape** — the fixtures fabricate `{ portfolioId, positions: [ {symbol, quantity} ] }` (ARRAY, no `snapshot`), which never matches `PortfolioUpdatedSchema` (record + required `snapshot`) — they have been silently red against the deployed handler (`reconciliation-ctrl/handlers/event-listener.ts:174` does `parseSubject(payload, PortfolioUpdatedSchema)`). Convert ARRAY→record, add a minimal `snapshot`, drop `portfolioId` (the handler derives `portfolioId = tenantId`, never reads the subject's). **Preserve each site's exact instruments+quantities** so the content-derived `reconciliationId` (and drift assertions) stay stable. `normalizePositions` reads only `symbol`+`quantity` from each record value, so the cost-basis fields are unread padding. Canonical (`reconciliation-ctrl.integration.test.ts` L45):

```ts
// BEFORE
detail: {
  portfolioId: `portfolio-integ-${ctx.tenantId}`,
  positions: [ { symbol: 'AAPL', quantity: 10 }, { symbol: 'MSFT', quantity: 5 } ],
},
// AFTER  (no context — the fixture carried no identity; ctx defaults apply)
subject: {
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0 },
    MSFT: { symbol: 'MSFT', quantity: 5,  averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0 },
  },
  snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 0 },
},
```
  Apply (preserving each site's instruments/quantities):
  - `reconciliation-ctrl.integration.test.ts` **L45** (AAPL:10, MSFT:5).
  - `reconciliation-ctrl.resilience.integration.test.ts` — the shared `const payload` at **L53** (AAPL:10, MSFT:5): rewrite the const to the `{ positions: {…}, snapshot }` record form (drop `portfolioId`), then at **L62, L81** change `detail: payload` → `subject: payload`.
  - `reconciliation-ctrl.resilience.integration.test.ts` **L141** (AAPL:10, MSFT:5), **L210** (AAPL:10 only), **L264** (AAPL:10 only) — inline reshape each.

  **(iii) (a) dashboard/read-model reshape** — fixtures are `{ cashBalanceCents, snapshot }`: top-level `cashBalanceCents` is excess (not in `PortfolioUpdatedSchema`) and top-level `positions` (required) is missing. The dashboard transforms only read `snapshot`, so mirror the snapshot's positions into the required top-level `positions` and drop `cashBalanceCents`:
  - `dashboard-bff.integration.test.ts` **L104, L468**:

```ts
// BEFORE: detail: { cashBalanceCents: 80000, snapshot: { cashBalanceCents, lastEventSequence, positions: { AAPL: {…} } } }
// AFTER:
subject: {
  positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 160 } },
  snapshot: { cashBalanceCents: 80000, lastEventSequence: 42, positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 160 } } },
},
```
  (Use each site's actual snapshot values; set top-level `positions` equal to that site's `snapshot.positions`. No `context` — no identity present.)
  - `read-model-projection.integration.test.ts` **L85** — reuse the `snapshotDetail` helper's snapshot (do NOT change the helper — Task 1 left it valid for BALANCE_UPDATED):

```ts
// BEFORE: detail: snapshotDetail(25, 5000)
// AFTER:
const sd = snapshotDetail(25, 5000);
await eb.putEvent({
  bus: 'investor', targetService: 'dashboard-bff',
  detailType: 'PORTFOLIO_UPDATED',
  subject: { positions: sd.snapshot.positions, snapshot: sd.snapshot },
});
```

- [ ] **Step 5: Apply Procedure VERIFY** for `ledger-ctrl`, `test-contracts`, `ledger-bff`, `reconciliation-ctrl`, `dashboard-bff`, `decision-workflow-ctrl`, `e2e-feature-tests` (read-model-projection lives under dashboard-bff; the e2e app is unchanged this task — skip its tsc unless touched). Zero NEW tsc errors; gate `OK`.

- [ ] **Step 6: Commit** (`refactor(ledger-ctrl): register PORTFOLIO_UPDATED + migrate ledger/reconciliation/dashboard/dwc fixtures, reshape co-wrong reconciliation array fixtures (typed-test-fixtures Phase 4)`), verify it landed.

---

### Task 3: `LEDGER_ENTRY_RECORDED` — extend map + migrate all sites

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/contracts.ts` (extend `ledgerCtrlEventSubjects`)
- Modify: `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

**Interfaces:**
- Extends `ledgerCtrlEventSubjects` with `LEDGER_ENTRY_RECORDED: LedgerEntryRecordedSchema`.

- [ ] **Step 1: Apply Procedure REG (extend).** Add `LEDGER_ENTRY_RECORDED: LedgerEntryRecordedSchema,` to `ledgerCtrlEventSubjects`; add `LEDGER_ENTRY_RECORDED` (after `INVESTOR_PROFILE_UPDATED`, before `MANDATE_ISSUED`) to JSON + `EXPECTED`.

- [ ] **Step 2: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 3: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — flags ledger-bff (4) + dashboard-bff (2).

- [ ] **Step 4: Apply Procedure MIG.**

  **Pure rename** (no identity; `{ streamType, lastEventSequence, snapshotAt, snapshot }` already matches; keep the `eventId` param where present):
  - `ledger-bff.integration.test.ts` **L108, L299, L315, L333** — `detail:`→`subject:`.

  **(a) dashboard reshape** — fixture is `{ tenantId, snapshotAt, entryType: 'TRADE', lastEventSequence, snapshot }`: `entryType` is excess (not in `LedgerEntryRecordedSchema`) and `tenantId` is identity. Remove `entryType`, hoist `tenantId`→context:
  - `dashboard-bff.integration.test.ts` **L211, L486**:

```ts
// BEFORE: detail: { tenantId: ctx.tenantId, snapshotAt: …, entryType: 'TRADE', lastEventSequence: 10, snapshot: {…} }
// AFTER:
subject: { lastEventSequence: 10, snapshotAt: …, snapshot: {…} },
context: { tenantId: ctx.tenantId },
```

- [ ] **Step 5: Apply Procedure VERIFY** for `ledger-ctrl`, `test-contracts`, `ledger-bff`, `dashboard-bff`. Zero NEW tsc errors; gate `OK`.

- [ ] **Step 6: Commit** (`refactor(ledger-ctrl): register LEDGER_ENTRY_RECORDED + migrate ledger-bff/dashboard fixtures (typed-test-fixtures Phase 4)`), verify it landed.

---

### Task 4: `RECONCILIATION_COMPLETED` — author `reconciliationCtrlEventSubjects` + migrate dashboard fixture

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/domain/contracts.ts` (widen zod import + new map)
- Modify: `libs/test-contracts/src/index.ts` (import + spread `reconciliationCtrlEventSubjects`)
- Modify: `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

**Interfaces:**
- Produces: `reconciliationCtrlEventSubjects` (from `@nestfolio/reconciliation-ctrl/contracts`) registering `RECONCILIATION_COMPLETED: ReconciliationResultSchema`. (`PORTFOLIO_DRIFT_DETECTED` is deliberately omitted — see the registration reference; Task 5 files the deferral.)

- [ ] **Step 1: Apply Procedure REG.** In `services/ledger/reconciliation-ctrl/src/domain/contracts.ts`, change `import { z } from 'zod';` → `import { z, type ZodTypeAny } from 'zod';`, then append:

```ts
/**
 * Test-fixture event→subject map for reconciliation-ctrl's CDC emissions. Co-located with the
 * producer-owned schemas; consumed only by `@nestfolio/test-contracts`. Only RECONCILIATION_COMPLETED
 * is registered: PORTFOLIO_DRIFT_DETECTED is deferred (its name collides with the unbuilt
 * weight-drift rebalance event consumed by decision-workflow-ctrl — see the Phase-4 plan / backlog).
 */
export const reconciliationCtrlEventSubjects = {
  RECONCILIATION_COMPLETED: ReconciliationResultSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Add `import { reconciliationCtrlEventSubjects } from '@nestfolio/reconciliation-ctrl/contracts';` + `...reconciliationCtrlEventSubjects,` to `libs/test-contracts/src/index.ts`. Add `RECONCILIATION_COMPLETED` (after `RECOMMENDATION_PROPOSED`, before `SEC_10K_UPDATED`) to JSON + `EXPECTED`.

- [ ] **Step 2: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 3: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — flags the single `dashboard-bff.integration.test.ts` L179 site.

- [ ] **Step 4: Apply Procedure MIG — (a) fix.** The fixture is `{ reconciliationId, completedAt }`: `completedAt` is excess and `status`/`driftCount` (required) are missing. The dashboard consumer no-ops on this event (guarded before `parseSubject`), so any schema-valid shape works:

```ts
// BEFORE (dashboard-bff.integration.test.ts L179)
detail: { reconciliationId: `integ-recon-${Date.now()}`, completedAt: new Date().toISOString() },
// AFTER  (no identity present → no context)
subject: { reconciliationId: `integ-recon-${Date.now()}`, status: 'COMPLETED', driftCount: 0 },
```

- [ ] **Step 5: Apply Procedure VERIFY** for `reconciliation-ctrl`, `test-contracts`, `dashboard-bff`. Zero NEW tsc errors; gate `OK`.

- [ ] **Step 6: Commit** (`refactor(reconciliation-ctrl): register RECONCILIATION_COMPLETED + migrate dashboard fixture (typed-test-fixtures Phase 4)`), verify it landed.

---

### Task 5: File deferrals + (a)/(b) tally + ship (static-only)

This task files backlog items via the `backlog-add` skill (epic-aware router; state which branch fired for each), records the (a)/(b) tally, and ships the backlog file. NO new registrations.

**Files:**
- New: `docs/backlog/<generated-id>.md` per filing (via `backlog-add`)
- Modify: `docs/backlog/typed-test-fixtures-execution-deferred-cross-domain.md` (append a Phase-4 note — do NOT reclassify; user decision: keep captured)
- Modify: `docs/backlog/typed-test-fixtures-phase4-ledger.md` (`status: shipped` + `validation_gate:`)
- Modify: `docs/BACKLOG.md` (regenerated)

- [ ] **Step 1: File the `PORTFOLIO_DRIFT_DETECTED` collision deferral** via `backlog-add`. Content: "Phase 4 deferred registering `PORTFOLIO_DRIFT_DETECTED` in the typed-fixtures registry: reconciliation-ctrl *produces* it with `DriftRecordSchema` `{reconciliationId, instrument, intentQty, settlementQty, drift}` (settlement drift, ledger bus), but the decision-workflow-ctrl integration fixture (L245) + the advisory e2e fixtures (`rebalance-on-drift.e2e.test.ts` L61, `reconciliation-correction.e2e.test.ts` L75) inject a *weight-drift* shape `{portfolioId, driftPercentage, driftDirection, detectedAt}` that NO real producer emits today (the weight-drift-detector is unbuilt). One detailType → two incompatible producer intents; the flat `detailType→schema` registry cannot hold both (same class as the deferred `ORDER_REJECTED` collision). Register once the collision is resolved — e.g. when `weight-drift-detector` ships (the weight-drift fixtures become real) and/or the registry gains a source-discriminant. Cross-ref `weight-drift-rebalance` epic + `typed-test-fixtures-execution-deferred-cross-domain`." Likely router branch: fold into the `typed-test-fixtures` epic as `captured`, or join `weight-drift-rebalance`.

- [ ] **Step 2: Append a Phase-4 note to `typed-test-fixtures-execution-deferred-cross-domain.md`** (do NOT change its `status`/`epic_role`). Add under a `## Phase 4 (2026-06-18)` heading: the execution events ledger *consumes* (`ORDER_FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED`, `ALPACA_ACCOUNT_SNAPSHOT`, `CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`) were kept deferred per the 2026-06-18 user decision (revisit at epic ship); their ledger `putEvent({ detail })` sites remain legacy/gate-invisible.

- [ ] **Step 3: (Optional) Note the stale `funded()` comment.** `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts` (~L74–77) claims `funded()` "emits a BALANCE_UPDATED without the contract-required snapshot" — STALE: `funded()` already includes `snapshot` + validates with `BalanceUpdatedSchema.parse`. If `docs/backlog/funded-fixture-balance-updated-missing-snapshot.md` exists and is open, mark it resolved (or note it) via `backlog-add`/a one-line edit; otherwise skip. Low priority.

- [ ] **Step 4: Compute the (a)/(b) tally.** Across Tasks 1–4: **(a)** = ledger-bff `deltaCents` ×2 (T1) + reconciliation array→record ×6 (T2) + dashboard PORTFOLIO_UPDATED positions/cashBalanceCents ×2 + read-model-projection ×1 (T2) + dashboard LEDGER_ENTRY_RECORDED `entryType` ×2 (T3) + dashboard RECONCILIATION_COMPLETED ×1 (T4) = **14 (a) fixes**. **(b)/deferrals** = 1 (`PORTFOLIO_DRIFT_DETECTED` collision, Step 1). Note the reconciliation array fixtures were silently red against deployed dev (Bug-A class) — the (a) reshape corrects them; the deployed-dev proof is owned by `typed-test-fixtures-consolidated-integration-e2e-verify`.

- [ ] **Step 5: Run the final full static gate.** Capture output for `validation_gate`:
```bash
node tools/check-typed-fixtures.mjs
pnpm nx test test-contracts --skip-nx-cache
pnpm nx lint ledger-ctrl reconciliation-ctrl ledger-bff investor-bff dashboard-bff decision-workflow-ctrl test-contracts e2e-feature-tests --skip-nx-cache
# tsc no-NEW-errors per touched project (record counts vs origin/main baseline):
npx tsc --noEmit -p services/ledger/ledger-ctrl/tsconfig.json
npx tsc --noEmit -p services/ledger/reconciliation-ctrl/tsconfig.json
npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json
npx tsc --noEmit -p services/investor/investor-bff/tsconfig.json
npx tsc --noEmit -p services/investor/dashboard-bff/tsconfig.json
npx tsc --noEmit -p services/advisory/decision-workflow-ctrl/tsconfig.json
npx tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json
```
Expected: gate `OK (… registered events)`; test-contracts 2/2; lint clean (pre-existing warnings only); each tsc has zero NEW errors in branch-touched files.

- [ ] **Step 6: Ship the backlog file.** In `docs/backlog/typed-test-fixtures-phase4-ledger.md` set `status: shipped` and fill `validation_gate:` with: the gate `OK` line + new registered-event count (+4: BALANCE_UPDATED, LEDGER_ENTRY_RECORDED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED), test-contracts 2/2, lint result, the per-project tsc NEW-error counts (expect 0), the (a)=14 / deferral=1 tally, the `PORTFOLIO_DRIFT_DETECTED` deferral id, and the note that deployed-dev runtime is owned by `typed-test-fixtures-consolidated-integration-e2e-verify`. With all 4 domains migrated, state the untyped-`putEvent` gate is workspace-wide (modulo the documented deferrals) and the epic is drainable.

- [ ] **Step 7: Regenerate the index.** `node .claude/skills/backlog-lint/lint.mjs --fix`.

- [ ] **Step 8: Commit** (`docs(backlog): ship typed-test-fixtures-phase4-ledger (static gates green; runtime decoupled) (typed-test-fixtures Phase 4)`), verify it landed.

---

## Self-Review

**Spec coverage:** §3 mechanism — reused as-is (registry + typed `putEvent` exist; Phase 4 adds the two ledger maps). §4 Phase 4 = ledger domain — covered by Tasks 1–4 (ledger PRODUCER wave: registers ledger-produced events + migrates every injector incl. cross-domain consumers, per the 2026-06-18 full-producer-wave decision). §6 regression gate — extended via name registration in each REG step (the gate is name-driven; no script change). §7 (a)/(b) triage — Task 5 logs the split (14 a, 1 deferral); the deferral is filed via `backlog-add`. §9 out-of-scope — no production code changed; the `ledger-ctrl-live-tax-lot` / `order-sf-input` forks are untouched (their `ORDER_*` events stay deferred); `PORTFOLIO_DRIFT_DETECTED` collision deferred not fixed.

**Placeholder scan:** Schemas, map literals, before/after transforms, per-site line lists, and commands are concrete. The only conditional (Task 5 Step 3 stale-comment) carries an explicit "skip if not present". The reconciliation per-site reshape gives the canonical transform + each site's instruments/quantities to preserve; the dashboard reshape gives the exact field add/remove. Line numbers are flagged as origin/main-relative ("read before editing").

**Type consistency:** `ledgerCtrlEventSubjects` (Tasks 1–3) and `reconciliationCtrlEventSubjects` (Task 4) are the two new maps; both spread into `EventSubjects` in `index.ts` (imports added in Task 1 + Task 4 respectively). Schema names (`BalanceUpdatedSchema`, `PortfolioUpdatedSchema`, `LedgerEntryRecordedSchema`, `ReconciliationResultSchema`) match `services/ledger/*/src/domain/contracts.ts` exactly. The 4 registered names are identical across the map, the JSON, and `EXPECTED`.

## Execution Handoff

See the closing-phase steps in `/backlog-next`: deploy detection will correctly report **no deploy** (test-layer + tooling only — the static gate IS the `validation_gate`); the deployed-dev integration/e2e run is decoupled to `typed-test-fixtures-consolidated-integration-e2e-verify`. After Task 5 ships the member, the `typed-test-fixtures` epic's last open core member (besides the consolidated-verify gate) is drained — surface that the epic is nearly drainable (offer to ship it per `/backlog-next` Step 1a.5, after the consolidated verify).
