# Typed Test Fixtures — Phase 3 (Execution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit the EXECUTION domain's test fixtures to the typed `putEvent({ detailType, subject, context })` API so a co-wrong execution fixture becomes a compile error, mirroring the shipped Phase 1 (investor) and Phase 2 (advisory) waves.

**Architecture:** Each execution producer exports an `<svc>EventSubjects` map (event detailType → producer-owned zod subject schema) co-located at the end of its `src/domain/contracts.ts`. Those maps compose into the single `EventSubjects` registry in `libs/test-contracts/src/index.ts`; the typed `putEvent` infers the subject type from `detailType` and runs `EventSubjects[detailType].parse(subject)` as a runtime backstop. Registration of an event name in `tools/typed-fixture-registered-events.json` brings every legacy `putEvent({ detail })` call-site of that name under the `tools/check-typed-fixtures.mjs` gate.

**Tech Stack:** TypeScript, zod, Nx, Jest, `@nestfolio/test-contracts` + `@nestfolio/test-support`, pure-Node gate script.

## Global Constraints

- **Test layer only — NO production code changes.** Authoring a producer's `<svc>EventSubjects` map and any new DRY subject schema in its `src/domain/contracts.ts` is permitted: those exports are consumed only by `@nestfolio/test-contracts`. Do NOT change any producer emission, consumer (`parseSubject`), CDK stack, or handler. (spec §2 non-goals, §9.)
- **Identity lives in `context`, never in the subject.** A per-test `tenantId`/`userId`/`region` moves out of the payload into `context: { … }`. An identity field left in a `subject:` is an excess-property compile error (the point).
- **Static-only validation gate (this phase).** Ship on: `check-typed-fixtures.mjs` prints `OK` + per-touched-service `tsc --noEmit` clean + `test-contracts` unit green + `lint` clean — all run with `--skip-nx-cache` for fixture-touching projects (spec §5 CORRECTION: the nx cache masks the test-only circular-dependency rule). The deployed-dev integration/e2e run is **decoupled** to the `typed-test-fixtures-consolidated-integration-e2e-verify` member (program decision 2026-06-17); do NOT deploy or run integration/e2e suites in this phase.
- **Scope = execution-confined (decided 2026-06-18).** Register + migrate ONLY execution-produced events whose `putEvent` call-sites are entirely within `services/execution/**` test files + `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`. DEFER (do not register) every execution-produced event that has a cross-domain consumer fixture, and the blocked `ORDER_*`/NormalizedOrderEvent family — Task 5 files one consolidated follow-up.
- **Worktree commits use `--no-verify`** (the pre-commit hook can't run `nx affected` in a worktree) and each commit must be verified to have landed. Commit message suffix:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Deliberately-invalid / unregistered-event fixtures** use `putRawEvent` (gate-invisible) — never typed `putEvent`. Valid-but-unregistered events may stay on the legacy `putEvent({ detail })` overload (the gate only flags registered names).
- **Registered event names stay alphabetically sorted** in both name-sources and in sync (the `registry.test.ts` sync test enforces it).

---

## Reusable Procedures

Each task references these three procedures verbatim (copied from the Phase 2 plan).

### Procedure REG — register a producer's event→schema map

1. In the producer's `src/domain/contracts.ts`, ensure the top imports include `import type { ZodTypeAny } from 'zod';` (add if absent; `import { z } from 'zod';` is already present).
2. Append the `export const <svc>EventSubjects = { … } as const satisfies Record<string, ZodTypeAny>;` map at the END of the file, after the schemas it references (with the doc-comment shown in the task).
3. In `libs/test-contracts/src/index.ts`: add `import { <svc>EventSubjects } from '@nestfolio/<svc>/contracts';` and add `...<svc>EventSubjects,` to the `EventSubjects` object literal.
4. Add each new event name (alphabetically) to BOTH name-sources:
   - `tools/typed-fixture-registered-events.json` → `registeredEvents` array.
   - `libs/test-contracts/test/registry.test.ts` → `EXPECTED` array.
5. Run the registry sync test: `pnpm nx test test-contracts --skip-nx-cache` — it pins `Object.keys(EventSubjects).sort()` to `EXPECTED` and asserts the JSON is in sync. Must pass before migrating call-sites.

### Procedure MIG — migrate a `putEvent` call-site

1. Rename the object key `detail:` → `subject:`.
2. Delete every identity field (`tenantId`, `userId`, `region`) from the payload and re-pass them in a `context: { … }` param.
3. Let `tsc --noEmit` surface remaining mismatches and classify each:
   - **(a) fixture-only wrong** — fix the fixture to satisfy the producer schema.
   - **(b) latent contract bug** — the co-wrong fixture hides a real producer/consumer mismatch. File via `backlog-add` (Task 5), leave the fixture matching the REAL producer, and if matching the producer can't yield a green fixture (producer/consumer field fork), DEFER that event (do not register it; migrate its call-sites via `putRawEvent` or leave legacy).
4. Unregistered events stay on the legacy `putEvent({ detail })` overload. Deliberately-invalid negative tests use `putRawEvent`.

### Procedure VERIFY — per-task gate

Run in order; all must pass before committing the task:
1. `pnpm nx test test-contracts --skip-nx-cache`
2. `npx tsc --noEmit -p services/execution/<svc>/tsconfig.json` for each producer touched this task (and `apps/e2e-feature-tests` if its file changed: `npx tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json`).
3. `node tools/check-typed-fixtures.mjs` → must print `OK (… registered events)` with zero violations.
4. `pnpm nx lint <proj> --skip-nx-cache` for each touched project.

---

## In-scope event → schema → home (reference table)

| detailType | Schema | Map (home file) | Migration call-sites |
|---|---|---|---|
| SIM_DEPOSIT_COMPLETED | `SimDepositCompletedSchema` | `brokerSimAdptEventSubjects` (broker-sim-adpt/contracts.ts) | broker-ctrl int L83,L404; resil L130,L165,L218,L303 |
| SIM_WITHDRAWAL_COMPLETED | `SimWithdrawalCompletedSchema` | broker-sim map | broker-ctrl int L150; resil L236,L285 |
| SIM_ORDER_FILLED | `VirtualTradeSchema` | broker-sim map | none (completeness) |
| SIM_ORDER_REJECTED | `VirtualTradeSchema` | broker-sim map | none (completeness) |
| ALPACA_ORDER_PLACED/FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED/CANCEL_FAILED | `AlpacaOrderResultSchema` | `brokerAlpacaAdptEventSubjects` (broker-alpaca-adpt/contracts.ts) | none (completeness) |
| ALPACA_TRANSFER_INITIATED/COMPLETED/FAILED | `AlpacaTransferResultSchema` (import from `@nestfolio/execution-adpt/domain`) | broker-alpaca map | broker-ctrl int L198 (FAILED), L468 (COMPLETED) |
| ALPACA_ACCOUNT_CHECK | `AlpacaAccountCheckSchema` (NEW, `z.object({})`) | broker-alpaca map | broker-alpaca int L196; e2e L529 |
| SIM_ORDER_REQUESTED | `BrokerOrderRequestSchema` (NEW) | `brokerCtrlEventSubjects` (broker-ctrl/contracts.ts) | broker-sim int L46; e2e L282 |
| ALPACA_ORDER_REQUESTED | `BrokerOrderRequestSchema` (NEW, shared) | broker-ctrl map | broker-alpaca int L75,L99,L264,L313; resil L91,L120; e2e L441 |
| SIM_DEPOSIT_INITIATED | `SimDepositInitiatedSubjectSchema` (NEW) | broker-ctrl map | broker-sim int L79,L105; e2e L259,L325 |
| ALPACA_TRANSFER_REQUESTED | `AlpacaTransferRequestSchema` (existing, `@nestfolio/execution-adpt/domain`) | broker-ctrl map | broker-alpaca int L123,L156,L285; resil L167,L196; e2e L487 (fix `amount`→`amountCents`) |
| SIM_WITHDRAWAL_REQUESTED | TRIAGE (Task 4) | broker-ctrl map *or* DEFER | broker-sim int L120; e2e L355 |

> All line numbers are from `origin/main` at plan time; re-confirm by reading the file before editing (a prior task's edits shift later lines within the same file).

**Deferred (Task 5, NOT registered):** `ALPACA_ACCOUNT_SNAPSHOT`; funding `DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED`, `WITHDRAWAL_REQUESTED/SETTLED/FAILED`; `BROKER_CIRCUIT_OPEN/CLOSED`, `BROKER_HEAL_ESCALATED`; `ORDER_FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED/ESCALATED`; `ORDER_SUBMITTED/STAGED/CREATED/UPDATED`, `STAGED_ORDER_CREATED/UPDATED`. `ACCOUNT_CLOSURE_REQUESTED` stays legacy (valid but unregistered; never emitted in production — Task 5 files the dead-flow note).

---

### Task 1: broker-sim-adpt output events — register + migrate (establishes the rhythm)

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/domain/contracts.ts` (append map + `ZodTypeAny` import)
- Modify: `libs/test-contracts/src/index.ts` (import + spread)
- Modify: `tools/typed-fixture-registered-events.json` (+4 names)
- Modify: `libs/test-contracts/test/registry.test.ts` (+4 names in `EXPECTED`)
- Modify: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`
- Modify: `services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts`

**Interfaces:**
- Produces: `brokerSimAdptEventSubjects` (exported from `@nestfolio/broker-sim-adpt/contracts`), registering `SIM_DEPOSIT_COMPLETED`, `SIM_WITHDRAWAL_COMPLETED`, `SIM_ORDER_FILLED`, `SIM_ORDER_REJECTED`.

- [ ] **Step 1: Apply Procedure REG.** Append to `services/execution/broker-sim-adpt/src/domain/contracts.ts`:

```ts
/**
 * Test-fixture event→subject map for broker-sim-adpt's CDC emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const brokerSimAdptEventSubjects = {
  SIM_DEPOSIT_COMPLETED: SimDepositCompletedSchema,
  SIM_WITHDRAWAL_COMPLETED: SimWithdrawalCompletedSchema,
  SIM_ORDER_FILLED: VirtualTradeSchema,
  SIM_ORDER_REJECTED: VirtualTradeSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Then add to `libs/test-contracts/src/index.ts`: `import { brokerSimAdptEventSubjects } from '@nestfolio/broker-sim-adpt/contracts';` and `...brokerSimAdptEventSubjects,` in `EventSubjects`. Add `SIM_DEPOSIT_COMPLETED`, `SIM_ORDER_FILLED`, `SIM_ORDER_REJECTED`, `SIM_WITHDRAWAL_COMPLETED` (alpha order) to both `tools/typed-fixture-registered-events.json` and `registry.test.ts` `EXPECTED`.

- [ ] **Step 2: Run the registry sync test (expect PASS).**

Run: `pnpm nx test test-contracts --skip-nx-cache`
Expected: PASS (keys match `EXPECTED`; JSON in sync).

- [ ] **Step 3: Confirm the gate now flags the legacy call-sites (expect FAIL).**

Run: `node tools/check-typed-fixtures.mjs`
Expected: non-zero exit listing the `SIM_DEPOSIT_COMPLETED` / `SIM_WITHDRAWAL_COMPLETED` `detail:` call-sites in the two broker-ctrl test files. This is the exact worklist for Step 4.

- [ ] **Step 4: Apply Procedure MIG to each flagged broker-ctrl call-site.** These payloads carry NO identity (DRY; ctx-stamped) — the transform is a pure `detail:`→`subject:` rename. Canonical example (`broker-ctrl.integration.test.ts` L83):

```ts
// BEFORE
await eb.putEvent({
  bus: 'execution', targetService: 'broker-ctrl',
  detailType: 'SIM_DEPOSIT_COMPLETED',
  detail: { depositId, amountCents: 100000, currency: 'USD', sourceEventId: 'evt-sim-dep', timestamp },
});
// AFTER
await eb.putEvent({
  bus: 'execution', targetService: 'broker-ctrl',
  detailType: 'SIM_DEPOSIT_COMPLETED',
  subject: { depositId, amountCents: 100000, currency: 'USD', sourceEventId: 'evt-sim-dep', timestamp },
});
```

Apply the identical rename at: `broker-ctrl.integration.test.ts` L150 (`SIM_WITHDRAWAL_COMPLETED`), L404 (`SIM_DEPOSIT_COMPLETED`); `broker-ctrl.resilience.integration.test.ts` L130, L165, L218, L303 (`SIM_DEPOSIT_COMPLETED`, several via the shared `payload` const at L121 — rename `detail: payload`→`subject: payload`), L236, L285 (`SIM_WITHDRAWAL_COMPLETED`). For the resilience shared-const cases, the const is passed positionally — change the call key, not the const.

- [ ] **Step 5: Apply Procedure VERIFY** for `broker-sim-adpt`, `broker-ctrl`, `test-contracts`.

- [ ] **Step 6: Commit.**

```bash
git add services/execution/broker-sim-adpt/src/domain/contracts.ts libs/test-contracts services/execution/broker-ctrl/test tools/typed-fixture-registered-events.json
git commit --no-verify -m "refactor(broker-sim-adpt): register sim output event subjects + migrate broker-ctrl fixtures (typed-test-fixtures Phase 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Verify it landed: `git log --oneline -1`.

---

### Task 2: broker-alpaca-adpt output events + ALPACA_ACCOUNT_CHECK — register + migrate

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/domain/contracts.ts` (new `AlpacaAccountCheckSchema` + map + imports)
- Modify: `libs/test-contracts/src/index.ts`, `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`

**Interfaces:**
- Produces: `brokerAlpacaAdptEventSubjects` (from `@nestfolio/broker-alpaca-adpt/contracts`) registering the 6 `ALPACA_ORDER_*`, 3 `ALPACA_TRANSFER_*`, and `ALPACA_ACCOUNT_CHECK`.
- Consumes: `AlpacaTransferResultSchema` from `@nestfolio/execution-adpt/domain` (existing dep of broker-alpaca-adpt).

- [ ] **Step 1: Author the empty account-check schema.** In `services/execution/broker-alpaca-adpt/src/domain/contracts.ts`, after the existing schemas:

```ts
/** ALPACA_ACCOUNT_CHECK is an empty-payload trigger — the handler reads no subject fields. */
export const AlpacaAccountCheckSchema = z.object({});
```

- [ ] **Step 2: Apply Procedure REG.** Add `import type { ZodTypeAny } from 'zod';` (if absent) and `import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';` (if not already imported), then append:

```ts
/**
 * Test-fixture event→subject map for broker-alpaca-adpt's CDC emissions. Co-located with the
 * producer-owned schemas; consumed only by `@nestfolio/test-contracts`.
 */
export const brokerAlpacaAdptEventSubjects = {
  ALPACA_ORDER_PLACED: AlpacaOrderResultSchema,
  ALPACA_ORDER_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_PARTIALLY_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_REJECTED: AlpacaOrderResultSchema,
  ALPACA_ORDER_CANCELLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_CANCEL_FAILED: AlpacaOrderResultSchema,
  ALPACA_TRANSFER_INITIATED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_COMPLETED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_FAILED: AlpacaTransferResultSchema,
  ALPACA_ACCOUNT_CHECK: AlpacaAccountCheckSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Wire `brokerAlpacaAdptEventSubjects` into `libs/test-contracts/src/index.ts`; add the 10 names (alpha) to the JSON + `EXPECTED`.

- [ ] **Step 3: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 4: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — flags `ALPACA_TRANSFER_FAILED`/`ALPACA_TRANSFER_COMPLETED` in `broker-ctrl.integration.test.ts` and `ALPACA_ACCOUNT_CHECK` in `broker-alpaca-adpt.integration.test.ts`.

- [ ] **Step 5: Apply Procedure MIG (pure `detail:`→`subject:`, no identity).**
  - `broker-ctrl.integration.test.ts` L198 (`ALPACA_TRANSFER_FAILED`), L468 (`ALPACA_TRANSFER_COMPLETED`).
  - `broker-alpaca-adpt.integration.test.ts` L196 (`ALPACA_ACCOUNT_CHECK`): `detail: {}` → `subject: {}`.

- [ ] **Step 6: Apply Procedure VERIFY** for `broker-alpaca-adpt`, `broker-ctrl`, `test-contracts`.

- [ ] **Step 7: Commit** (`refactor(broker-alpaca-adpt): register alpaca output event subjects + account-check schema + migrate fixtures (typed-test-fixtures Phase 3)`), verify it landed.

---

### Task 3: Inbound order commands (SIM_ORDER_REQUESTED + ALPACA_ORDER_REQUESTED) — author DRY + register + migrate

**Files:**
- Modify: `services/execution/broker-ctrl/src/domain/contracts.ts` (new `BrokerOrderRequestSchema` + start `brokerCtrlEventSubjects` map)
- Modify: `libs/test-contracts/src/index.ts`, `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/execution/broker-sim-adpt/test/integration/broker-sim-adpt.integration.test.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts`
- Modify: `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`
- Modify (if needed): `apps/e2e-feature-tests/jest.config.js` (moduleNameMapper for `@nestfolio/broker-ctrl/contracts` etc.)

**Interfaces:**
- Produces: `brokerCtrlEventSubjects` (from `@nestfolio/broker-ctrl/contracts`) and `BrokerOrderRequestSchema`. `SIM_ORDER_REQUESTED` and `ALPACA_ORDER_REQUESTED` both map to `BrokerOrderRequestSchema`.

- [ ] **Step 1: Author the DRY order-request schema.** The production producer is `broker-ctrl/src/handlers/route-order.ts:52-58`, which emits `{ orderId, userId, symbol, side, quantity }` — `userId` is on the subject (non-DRY; filed in Task 5). The DRY subject is identity-free. In `services/execution/broker-ctrl/src/domain/contracts.ts`:

```ts
/**
 * DRY subject for the order-routing commands broker-ctrl emits to the broker adapters
 * (SIM_ORDER_REQUESTED / ALPACA_ORDER_REQUESTED). Identity (userId/tenantId) is carried in the
 * envelope context, not the subject. NB: the live producer (route-order.ts) currently also puts
 * userId on the subject — tracked as a latent non-DRY producer bug (see Task 5 filing).
 */
export const BrokerOrderRequestSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number(),
});
```

- [ ] **Step 2: Apply Procedure REG.** Add `import type { ZodTypeAny } from 'zod';` (if absent) and append:

```ts
/**
 * Test-fixture event→subject map for broker-ctrl's emissions. Co-located with the producer-owned
 * schemas; consumed only by `@nestfolio/test-contracts`. Grows across Tasks 3 and 4.
 */
export const brokerCtrlEventSubjects = {
  SIM_ORDER_REQUESTED: BrokerOrderRequestSchema,
  ALPACA_ORDER_REQUESTED: BrokerOrderRequestSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Wire into `index.ts`; add `ALPACA_ORDER_REQUESTED`, `SIM_ORDER_REQUESTED` (alpha) to JSON + `EXPECTED`.

- [ ] **Step 3: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 4: Ensure e2e jest can resolve the new contract subpath.** If `node tools/check-typed-fixtures.mjs` or the e2e tsc later fails to load `@nestfolio/broker-ctrl/contracts`, add to `apps/e2e-feature-tests/jest.config.js` `moduleNameMapper` (mirroring the existing advisory entries):

```js
'^@nestfolio/broker-ctrl/contracts$': '<rootDir>/../../services/execution/broker-ctrl/src/domain/contracts.ts',
```
(Also add `broker-sim-adpt`, `broker-alpaca-adpt` entries here when their maps are imported transitively via `@nestfolio/test-contracts`. This is the known `e2e-jest-modulenamemapper-auto-derive` gap — hand-add for now.)

- [ ] **Step 5: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs` — flags the `SIM_ORDER_REQUESTED` / `ALPACA_ORDER_REQUESTED` `detail:` sites.

- [ ] **Step 6: Apply Procedure MIG (identity → context).** Canonical example (`broker-sim-adpt.integration.test.ts` L46):

```ts
// BEFORE
await eb.putEvent({
  bus: 'execution', targetService: 'broker-sim-adpt',
  detailType: 'SIM_ORDER_REQUESTED',
  detail: { orderId, userId: ctx.userId, symbol: 'VTI', side: 'BUY', quantity: 1 },
});
// AFTER
await eb.putEvent({
  bus: 'execution', targetService: 'broker-sim-adpt',
  detailType: 'SIM_ORDER_REQUESTED',
  subject: { orderId, symbol: 'VTI', side: 'BUY', quantity: 1 },
  context: { userId: ctx.userId },
});
```

Apply to each flagged site:
  - `broker-alpaca-adpt.integration.test.ts` L75, L99, L264, L313 (`ALPACA_ORDER_REQUESTED`, no identity → just `detail:`→`subject:`).
  - `broker-alpaca-adpt.resilience.integration.test.ts` L91, L120 (`ALPACA_ORDER_REQUESTED` via shared `payload` const L88 → change the call key).
  - `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` L282 (`SIM_ORDER_REQUESTED`, `{ orderId, tenantId, userId, symbol, side, quantity }` → subject `{ orderId, symbol, side, quantity }`, `context: { tenantId: tenant.tenantId, userId: tenant.userId }`), L441 (`ALPACA_ORDER_REQUESTED`, no identity).

- [ ] **Step 7: Apply Procedure VERIFY** for `broker-ctrl`, `broker-sim-adpt`, `broker-alpaca-adpt`, `apps/e2e-feature-tests`, `test-contracts`.

- [ ] **Step 8: Commit** (`refactor(broker-ctrl): author DRY order-request subject + register + migrate adapter inbound fixtures (typed-test-fixtures Phase 3)`), verify it landed.

---

### Task 4: Inbound funding/transfer commands — author DRY + register + migrate (with triage)

**Files:**
- Modify: `services/execution/broker-ctrl/src/domain/contracts.ts` (new `SimDepositInitiatedSubjectSchema`; conditional `SimWithdrawalRequestedSubjectSchema`; extend `brokerCtrlEventSubjects`)
- Modify: `libs/test-contracts/src/index.ts` (already imports `brokerCtrlEventSubjects`; no new import), `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Modify: `services/execution/broker-sim-adpt/test/integration/broker-sim-adpt.integration.test.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts`
- Modify: `apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts`

**Interfaces:**
- Consumes: `BrokerOrderRequestSchema`, `brokerCtrlEventSubjects` (Task 3); `AlpacaTransferRequestSchema` from `@nestfolio/execution-adpt/domain` (existing, `{ transferId, amountCents, currency, direction, relationshipId }`).
- Produces: `SimDepositInitiatedSubjectSchema`; `brokerCtrlEventSubjects` extended with `SIM_DEPOSIT_INITIATED`, `ALPACA_TRANSFER_REQUESTED`, and conditionally `SIM_WITHDRAWAL_REQUESTED`.

- [ ] **Step 1: TRIAGE SIM_WITHDRAWAL_REQUESTED before authoring.** The producer (`broker-ctrl/src/handlers/deposit-withdrawal-router.ts:69-78`) emits `{ withdrawalId, amountCents, currency, direction: 'OUTGOING' }`, but the broker-sim consumer's inbound schema (`broker-sim-adpt/src/domain/schemas.ts` `SimWithdrawalRequestedSchema`) reads `amount` (dollars). Confirm which the handler reads:

Run: `grep -n "amount" services/execution/broker-sim-adpt/src/handlers/*.ts`
  - **If the handler reads `amountCents`** → the `schemas.ts` `amount` is stale; proceed to author `SimWithdrawalRequestedSubjectSchema` (Step 2) and migrate (a).
  - **If the handler reads `amount` (dollars)** → producer/consumer field FORK. DO NOT register `SIM_WITHDRAWAL_REQUESTED`; leave its two call-sites (`broker-sim-adpt.integration.test.ts` L120, e2e L355) on legacy `putEvent({ detail })`; file the fork in Task 5. Skip the `SIM_WITHDRAWAL_REQUESTED` parts of Steps 2/5/6.

- [ ] **Step 2: Author the DRY funding-command schemas.** In `services/execution/broker-ctrl/src/domain/contracts.ts`:

```ts
/** DRY subject for the deposit-routing command broker-ctrl emits to broker-sim (SIM_DEPOSIT_INITIATED). */
export const SimDepositInitiatedSubjectSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.literal('INCOMING'),
});
```
(Only if Step 1 chose the non-fork branch, also add:)
```ts
/** DRY subject for the withdrawal-routing command broker-ctrl emits to broker-sim (SIM_WITHDRAWAL_REQUESTED). */
export const SimWithdrawalRequestedSubjectSchema = z.object({
  withdrawalId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.literal('OUTGOING'),
});
```

- [ ] **Step 3: Apply Procedure REG.** Extend `brokerCtrlEventSubjects` with:
```ts
  SIM_DEPOSIT_INITIATED: SimDepositInitiatedSubjectSchema,
  ALPACA_TRANSFER_REQUESTED: AlpacaTransferRequestSchema,   // imported from @nestfolio/execution-adpt/domain
  // SIM_WITHDRAWAL_REQUESTED: SimWithdrawalRequestedSubjectSchema,  // only if Step 1 non-fork
```
Add `import { AlpacaTransferRequestSchema } from '@nestfolio/execution-adpt/domain';` to broker-ctrl/contracts.ts. Add the new names (alpha) to JSON + `EXPECTED`.

- [ ] **Step 4: Registry sync test (expect PASS).** `pnpm nx test test-contracts --skip-nx-cache`.

- [ ] **Step 5: Gate worklist (expect FAIL).** `node tools/check-typed-fixtures.mjs`.

- [ ] **Step 6: Apply Procedure MIG.**
  - `SIM_DEPOSIT_INITIATED`: `broker-sim-adpt.integration.test.ts` L79, L105 (`{ depositId, userId: ctx.userId, amountCents, currency }` → `subject: { depositId, amountCents, currency, direction: 'INCOMING' }`, `context: { userId: ctx.userId }` — **(a): add `direction`, hoist userId**); e2e L259, L325 (same, identity → context).
  - `ALPACA_TRANSFER_REQUESTED`: `broker-alpaca-adpt.integration.test.ts` L123, L156, L285 + `…resilience…` L167, L196 (already `{ transferId, amountCents, currency, direction, relationshipId }` → pure `detail:`→`subject:`); **e2e L487 `{ transferId, direction, amount, relationshipId }` → `subject: { transferId, amountCents: <amount*100 or the intended cents>, currency: 'USD', direction, relationshipId }` — (a) fixture fix: `amount`→`amountCents` + add `currency`** (the handler `processTransferRequested` parses against `AlpacaTransferRequestSchema`, so the prior shape would have thrown on the real producer). Log this as an (a) in Task 6's tally.
  - `SIM_WITHDRAWAL_REQUESTED` (only if Step 1 non-fork): `broker-sim-adpt.integration.test.ts` L120, e2e L355 → `subject: { withdrawalId, amountCents, currency, direction: 'OUTGOING' }`, identity → context.

- [ ] **Step 7: Apply Procedure VERIFY** for `broker-ctrl`, `broker-sim-adpt`, `broker-alpaca-adpt`, `apps/e2e-feature-tests`, `test-contracts`.

- [ ] **Step 8: Commit** (`refactor(broker-ctrl): author DRY funding/transfer-command subjects + register + migrate inbound fixtures (typed-test-fixtures Phase 3)`), verify it landed.

---

### Task 5: File deferred follow-up + surfaced latent (b) bugs

This task produces NO registrations — it files backlog items via the `backlog-add` skill (epic-aware router) and leaves a corrected TODO comment. Run `backlog-add` once per item below; state which router branch fired for each.

**Files:**
- New: `docs/backlog/<generated-id>.md` per filing (via `backlog-add`)
- Modify: `docs/BACKLOG.md` (regenerated by `backlog-add`'s `backlog-lint --fix`)
- Modify: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (correct the stale TODO comment at ~L116)

- [ ] **Step 1: File the consolidated deferral** (epic `typed-test-fixtures`, `epic_role: captured` — rides along, does not block closure). Content: "Phase 3 (execution) deferred the execution-produced events whose consumer fixtures live in other domains' test files — `ALPACA_ACCOUNT_SNAPSHOT` (ledger reconciliation), funding `DEPOSIT_*`/`WITHDRAWAL_*` (investor/advisory/ledger), `BROKER_CIRCUIT_*` (investor) — plus the blocked `ORDER_*`/NormalizedOrderEvent family. The `ORDER_*` family is blocked because (1) `ORDER_REJECTED` collides on a flat registry (execution-ctrl `OrderSchema` vs broker-ctrl `NormalizedOrderEventSchema`) and (2) the cross-domain `ORDER_FILLED`/`ORDER_REJECTED` fixtures fabricate `{symbol,side,quantity,fillPrice}` that `NormalizedOrderEventSchema` does not carry — fixing them is entangled with the parked production forks `ledger-ctrl-live-tax-lot-missing-order-fields` + `broker-ctrl-order-sf-input-contract-gap` (spec §9 out-of-scope). Register + migrate these in the consuming-domain wave (Phase 4 / ledger) once those production forks are resolved." Cross-reference both parked bug ids.

- [ ] **Step 2: File the route-order non-DRY producer bug** (execution; router will likely fold/orphan). Content: "`broker-ctrl/src/handlers/route-order.ts:52-58` emits `SIM_ORDER_REQUESTED`/`ALPACA_ORDER_REQUESTED` with `userId` ON the subject (non-DRY); identity should live in context only. The Phase-3 `BrokerOrderRequestSchema` is DRY (identity-free) and the adapter consumers read identity from context, so no runtime break — but the producer emission carries a redundant identity field. Same class as `dwc-sf-command-subject-tenantid-nondry`."

- [ ] **Step 3: File the non-DRY adapter inbound schemas** (execution). Content: "`broker-sim-adpt/src/domain/schemas.ts` `SimOrderRequestedSchema` / `SimDepositInitiatedSchema` / `SimWithdrawalRequestedSchema` are `BusEventSchema.extend` inbound schemas that carry `tenantId`/`userId` IN the subject (non-DRY) — they model what the consumer receives, not a DRY producer contract. The Phase-3 typed fixtures use the producer-owned DRY schemas in broker-ctrl instead; these consumer-side schemas remain non-DRY."

- [ ] **Step 4: File the SIM_WITHDRAWAL_REQUESTED fork** — ONLY if Task 4 Step 1 found the fork. Content: "broker-ctrl emits `SIM_WITHDRAWAL_REQUESTED` with `{ withdrawalId, amountCents, currency, direction }` but the broker-sim consumer reads `amount` (dollars) — producer/consumer field-name fork (amountCents vs amount). Deferred from Phase 3 registration. Cross-ref `ledger-ctrl-live-tax-lot-missing-order-fields` (same producer/consumer minimal-shape class)."

- [ ] **Step 5: File the ACCOUNT_CLOSURE_REQUESTED dead-flow note** (execution). Content: "`ACCOUNT_CLOSURE_REQUESTED` is declared in investor-bff/investor-adpt/execution-adpt/execution-ctrl events.ts but has NO production emitter — `investor-bff requestAccountClosure` is a `noneDataSource` synthetic mutation (no DDB write → no CDC), and `execution-ctrl/src/handlers/event-listener.ts:103` logs + `skip()`s it. The execution-ctrl integration fixture (L96) emits it but exercises only the skip path. Left unregistered/legacy in Phase 3. Decide whether to wire or remove the event."

- [ ] **Step 6: Correct the stale TODO.** In `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (~L116), update the `TODO(typed-test-fixtures Phase 4)` comment to point at the Step-1 consolidated-deferral backlog id, noting `ORDER_*`/`BROKER_CIRCUIT_*` registration is deferred there.

- [ ] **Step 7: Commit** (`docs(backlog): file Phase-3 execution deferrals + latent (b) bugs (typed-test-fixtures Phase 3)`), verify it landed. (No code/registration changes; `backlog-add` already ran `backlog-lint --fix`.)

---

### Task 6: Final verification, (a)/(b) tally, and ship (static-only)

**Files:**
- Modify: `docs/backlog/typed-test-fixtures-phase3-execution.md` (`status: shipped` + `validation_gate:`)
- Modify: `docs/BACKLOG.md` (regenerated)

- [ ] **Step 1: Full static gate across all touched projects.** Run and capture output for the validation gate:

```bash
node tools/check-typed-fixtures.mjs
npx tsc --noEmit -p services/execution/broker-sim-adpt/tsconfig.json
npx tsc --noEmit -p services/execution/broker-alpaca-adpt/tsconfig.json
npx tsc --noEmit -p services/execution/broker-ctrl/tsconfig.json
npx tsc --noEmit -p apps/e2e-feature-tests/tsconfig.json
pnpm nx test test-contracts --skip-nx-cache
pnpm nx lint broker-sim-adpt broker-alpaca-adpt broker-ctrl test-contracts e2e-feature-tests --skip-nx-cache
```
Expected: gate prints `OK`; all tsc clean; test-contracts green; lint clean.

- [ ] **Step 2: Compute the (a)/(b) tally.** Count fixtures corrected (a) vs latent bugs filed (b) across Tasks 1-5. Record the totals (e.g. `(a)=N (b)=M`) for the ship commit body and `validation_gate`.

- [ ] **Step 3: Ship the backlog file.** In `docs/backlog/typed-test-fixtures-phase3-execution.md` set `status: shipped` and fill `validation_gate:` with concrete evidence: the static-gate command outputs (gate `OK`, tsc clean, test-contracts pass, lint clean), the `(a)/(b)` tally, the list of registered execution events, the deferred set + the Task-5 follow-up id, and the explicit note that deployed-dev runtime is owned by `typed-test-fixtures-consolidated-integration-e2e-verify`.

- [ ] **Step 4: Regenerate the index.** `node .claude/skills/backlog-lint/lint.mjs --fix`.

- [ ] **Step 5: Commit** (`docs(backlog): ship typed-test-fixtures-phase3-execution (static gates green; runtime decoupled) (typed-test-fixtures Phase 3)`), verify it landed.

---

## Self-Review

**Spec coverage:** §3 mechanism — reused as-is (registry + typed `putEvent` already exist; Phase 3 only adds maps). §4 Phase 3 = execution domain — covered by Tasks 1-4 (the execution-confined subset per the 2026-06-18 scope decision; the remainder is explicitly deferred + filed in Task 5, no silent truncation). §6 regression gate — extended via name registration in every REG step (no gate-script change needed; one-time work was Phase 1). §7 (a)/(b) triage — Tasks 4-6 log the split; (b)s filed via `backlog-add`. §9 out-of-scope — the `ledger-ctrl-live-tax-lot` / `order-sf-input` production forks are NOT touched; the `ORDER_*` family that depends on them is deferred.

**Placeholder scan:** Schemas, map literals, before/after transforms, and commands are concrete. The two genuinely conditional points (SIM_WITHDRAWAL_REQUESTED fork; e2e jest moduleNameMapper) carry an exact grep/decision rather than a TODO. The cross-domain call-site long tail is intentionally NOT enumerated because it is out of scope (deferred) — the in-scope sites are listed exactly by file:line.

**Type consistency:** `brokerSimAdptEventSubjects` / `brokerAlpacaAdptEventSubjects` / `brokerCtrlEventSubjects` are the three new maps; `BrokerOrderRequestSchema` (Task 3) is consumed by Task 4's REG; `AlpacaTransferRequestSchema` / `AlpacaTransferResultSchema` are imported from `@nestfolio/execution-adpt/domain` (existing). `AlpacaAccountCheckSchema` is new in broker-alpaca. All names are used consistently across tasks.

## Execution Handoff

See the closing-phase steps in `/backlog-next` (deploy detection will correctly report **no deploy** — test-layer + tooling only — and the static gate IS the validation_gate).
