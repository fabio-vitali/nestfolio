# Typed-Test-Fixtures — Cross-Domain Consumer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the 6 contracted execution-produced events in the typed-fixtures `EventSubjects` registry and migrate their static-`detailType` consumer `putEvent({ detail })` sites (reconciliation-ctrl, ledger-ctrl, investor-bff) to the typed `subject:`/`context:` form, so `check-typed-fixtures` no longer skips them.

**Architecture:** Each producer registers its own events in its local `*EventSubjects` map (already spread into the composed `@nestfolio/test-contracts` registry). A flat JSON allowlist (`tools/typed-fixture-registered-events.json`, synced by `registry.test.ts`) feeds the pure-Node `check-typed-fixtures` gate. Consumer fixtures move identity to the event `context` and pass a schema-conformant `subject`; `tsc` (`subject: SubjectOf<K>`) is the compile-time conformance guarantee, `schema.parse` the runtime backstop.

**Tech Stack:** TypeScript, zod, Jest/ts-jest, Nx, `@nestfolio/test-support` `EventBridgeClient.putEvent`.

## Global Constraints

- **Test-layer migration ONLY.** No producer/consumer handler logic changes, no event-schema changes, no deploy. (Registering an event = adding a `NAME: Schema` entry to a producer's existing `*EventSubjects` map — the established Phase 1–4 deliverable, NOT a production behavior change.)
- **Runtime verification is DECOUPLED** to `typed-test-fixtures-consolidated-integration-e2e-verify` (rank 5). This workstream's gate is STATIC: `check-typed-fixtures` (0 violations for the 6 events) + `registry.test.ts` sync + per-service `tsc` error-count-unchanged + lint + affected unit tests. Do NOT run integration/e2e against deployed dev here.
- **DRY subjects:** identity (`tenantId`/`userId`/`region`) travels in `context`, never the subject. `context` fields default to `ctx.tenantId/userId/region` — OMIT `context` when the fixture used only the suite's identity; pass it only to override (e.g. a per-test `userId`/`SYSTEM` tenant).
- **Verify against the REAL producer, not the fixture** ([[event-subject-contracts]] lesson). The producer-owned schemas below ARE the real shapes (confirmed against service cards + producer code).
- **Worktree commits use `--no-verify`** and must be verified to have landed ([[feedback-worktree-commit-no-verify]]). Drive edits by the worktree absolute path.
- **Out of scope (recorded in the backlog item):**
  - `CORPORATE_ACTION_APPLIED` / `PORTFOLIO_SNAPSHOT_IMPORTED` — no producer contract → [[corporate-action-portfolio-snapshot-no-producer-contract]].
  - `ORDER_*`/`NormalizedOrderEvent` family → [[typed-test-fixtures-execution-deferred-cross-domain]].
  - **Dynamic-`detailType` `it.each` sites** in `investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (`notificationEvents` + `circuitBreakerEvents` arrays, ~lines 117/195) — they pass `detailType` as a VARIABLE, which the gate exempts (printed as a `note:`) and the typed overload cannot narrow. These belong to [[check-typed-fixtures-dynamic-detailtype-gap]] (rank 4), which fixes the gate to catch dynamic detailType. NOT migrated here.

## Producer schemas (the conformance targets)

| Event | Producer | Schema (file) | DRY subject fields |
| --- | --- | --- | --- |
| `ALPACA_ACCOUNT_SNAPSHOT` | broker-alpaca-adpt | `AlpacaAccountSnapshotSchema` (`broker-alpaca-adpt/src/domain/contracts.ts:28`) | `equity: string\|null`, `buyingPower: string\|null`, `positions: {symbol,qty:number,marketValue:number}[]`, `status?`, `failureReason?` |
| `BROKER_CIRCUIT_OPEN` / `_CLOSED` / `BROKER_HEAL_ESCALATED` | broker-alpaca-adpt | `BrokerCircuitEventSchema` (`broker-alpaca-adpt/src/domain/contracts.ts:43`) | `adapter: string`, `timestamp: string` (**both required** — `{}` fails parse) |
| `DEPOSIT_SETTLED` / `WITHDRAWAL_SETTLED` | broker-ctrl | `FundingSnapshotSchema` (`execution-adpt/src/domain/contracts.ts:17`) | `sk`, `direction:'DEPOSIT'\|'WITHDRAWAL'`, `status:'requested'\|'detected'\|'settled'\|'failed'`, `transferId`, `amountCents:number`, `currency`, `executionMode:'simulation'\|'live'`, `initiatedAt`, `detectedAt?`, `settledAt?`, `failedAt?`, `reason?`, `timestamp`, `__version?` |

---

### Task 1: Register the 6 events + generate the migration worklist

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/domain/contracts.ts:67-78` (`brokerAlpacaAdptEventSubjects`)
- Modify: `services/execution/broker-ctrl/src/domain/contracts.ts:1-5,89-95` (import + `brokerCtrlEventSubjects`)
- Modify: `tools/typed-fixture-registered-events.json` (add 6 names, keep array sorted)
- Test: `libs/test-contracts/test/registry.test.ts` (the JSON↔registry sync test)

**Interfaces:**
- Produces: 6 new `RegisteredEventName`s — `ALPACA_ACCOUNT_SNAPSHOT`, `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED` — with `SubjectOf<K>` = the schemas above.

- [ ] **Step 1: Add the 4 broker-alpaca-adpt events** to `brokerAlpacaAdptEventSubjects` (keep keys alphabetical):

```ts
export const brokerAlpacaAdptEventSubjects = {
  ALPACA_ACCOUNT_CHECK: AlpacaAccountCheckSchema,
  ALPACA_ACCOUNT_SNAPSHOT: AlpacaAccountSnapshotSchema,
  ALPACA_ORDER_CANCEL_FAILED: AlpacaOrderResultSchema,
  ALPACA_ORDER_CANCELLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_PARTIALLY_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_PLACED: AlpacaOrderResultSchema,
  ALPACA_ORDER_REJECTED: AlpacaOrderResultSchema,
  ALPACA_TRANSFER_COMPLETED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_FAILED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_INITIATED: AlpacaTransferResultSchema,
  BROKER_CIRCUIT_CLOSED: BrokerCircuitEventSchema,
  BROKER_CIRCUIT_OPEN: BrokerCircuitEventSchema,
  BROKER_HEAL_ESCALATED: BrokerCircuitEventSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Add `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED` to broker-ctrl.** Extend the existing `@nestfolio/execution-adpt/domain` import (line 5) to add `FundingSnapshotSchema`, then add the two entries:

```ts
// line 5:
import { AlpacaTransferRequestSchema, FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';
```
```ts
export const brokerCtrlEventSubjects = {
  ALPACA_ORDER_REQUESTED: BrokerOrderRequestSchema,
  ALPACA_TRANSFER_REQUESTED: AlpacaTransferRequestSchema,
  DEPOSIT_SETTLED: FundingSnapshotSchema,
  SIM_DEPOSIT_INITIATED: SimDepositInitiatedSubjectSchema,
  SIM_ORDER_REQUESTED: BrokerOrderRequestSchema,
  SIM_WITHDRAWAL_REQUESTED: SimWithdrawalRequestedSubjectSchema,
  WITHDRAWAL_SETTLED: FundingSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 3: Add the 6 names to the gate allowlist** `tools/typed-fixture-registered-events.json` (insert in sorted position): `ALPACA_ACCOUNT_SNAPSHOT`, `BROKER_CIRCUIT_CLOSED`, `BROKER_CIRCUIT_OPEN`, `BROKER_HEAL_ESCALATED`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED`.

- [ ] **Step 4: Run the registry sync test** (proves JSON == composed registry keys):

Run: `pnpm nx run test-contracts:test`
Expected: PASS (the sync test in `registry.test.ts` confirms `tools/typed-fixture-registered-events.json` matches `Object.keys(EventSubjects)`).

- [ ] **Step 5: Generate the migration worklist** — run the gate; it now flags the static `putEvent({ detail })` sites for the 6 newly-registered events:

Run: `node tools/check-typed-fixtures.mjs`
Expected: NON-ZERO exit, listing flagged sites in `reconciliation-ctrl`, `ledger-ctrl`, `investor-bff` test files. Record the exact file:line list — that is the Task 2–4 worklist. (Dynamic-detailType sites print as `note:` to stderr — ignore them, they are out of scope.)

- [ ] **Step 6: Commit**

```bash
cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/typed-fixtures-cross-domain
git add services/execution/broker-alpaca-adpt/src/domain/contracts.ts services/execution/broker-ctrl/src/domain/contracts.ts tools/typed-fixture-registered-events.json
git commit --no-verify -m "test(typed-fixtures): register 6 cross-domain execution events in EventSubjects"
git log --oneline -1   # verify it landed
```

---

### Task 2: Migrate reconciliation-ctrl `ALPACA_ACCOUNT_SNAPSHOT` sites

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.integration.test.ts` (site ~:31)
- Modify: `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts` (sites ~:39,135,164,228,256)

**Interfaces:**
- Consumes: `ALPACA_ACCOUNT_SNAPSHOT` registered in Task 1.

**Context:** The consumer (`event-listener.ts`, "Settlement" side) maps `positions[].symbol→instrument`, `positions[].qty→quantity` and ignores `equity`/`buyingPower`/`marketValue`. The legacy fixture omitted those + put `tenantId` in `detail`. The schema REQUIRES `equity`, `buyingPower`, and per-position `marketValue` — add them (consumer ignores them, so behavior is unchanged). `tenantId` defaults from `ctx`, so drop it.

- [ ] **Step 1: Migrate each flagged site.** Canonical transform (apply to every flagged `ALPACA_ACCOUNT_SNAPSHOT` site in both files):

Before:
```ts
await eb.putEvent({
  bus: 'ledger',
  targetService: 'reconciliation-ctrl',
  detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
  detail: {
    tenantId: ctx.tenantId,
    positions: [ { symbol: 'AAPL', qty: 10 }, { symbol: 'MSFT', qty: 5 } ],
  },
});
```
After:
```ts
await eb.putEvent({
  bus: 'ledger',
  targetService: 'reconciliation-ctrl',
  detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
  subject: {
    equity: '0',
    buyingPower: '0',
    positions: [
      { symbol: 'AAPL', qty: 10, marketValue: 0 },
      { symbol: 'MSFT', qty: 5, marketValue: 0 },
    ],
  },
});
```

(Preserve each site's own `qty`/`symbol` values; the resilience sites with redelivery use the same per-site positions — only add `equity`/`buyingPower`/`marketValue` and drop `tenantId`. If a site overrode tenant via `detail.tenantId` to a NON-`ctx` value, pass `context: { tenantId: <that value> }` instead of dropping it — check each site.)

- [ ] **Step 2: Verify the gate no longer flags these files**

Run: `node tools/check-typed-fixtures.mjs 2>/dev/null; echo "exit=$?"` then grep the output for `reconciliation-ctrl` — expect none.

- [ ] **Step 3: Verify no new tsc errors**

Run: `pnpm exec tsc --noEmit -p services/ledger/reconciliation-ctrl/tsconfig.json 2>&1 | grep -c 'error TS'`
Expected: same count as the pre-migration baseline (capture the baseline first with the same command on the unmodified file via `git stash`/compare, or confirm the count is the known-good value). The migrated `subject` lines must add ZERO errors.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/reconciliation-ctrl/test/integration/
git commit --no-verify -m "test(typed-fixtures): migrate reconciliation-ctrl ALPACA_ACCOUNT_SNAPSHOT fixtures to typed subject"
git log --oneline -1
```

---

### Task 3: Migrate ledger-ctrl `DEPOSIT_SETTLED` / `WITHDRAWAL_SETTLED` sites (CO-WRONG — investigate)

**Files:**
- Modify: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts` (sites ~:104,121,243,264)
- Modify: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts` (sites flagged by the gate)
- Read (investigate): `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`, `services/ledger/ledger-ctrl/src/domain/record-deposit.ts`, `record-withdrawal.ts`

**Context:** The legacy fixture is CO-WRONG — `{ depositId, amountCents, settledAt }` vs the real `FundingSnapshotSchema` `{ sk, direction, status, transferId, amountCents, currency, executionMode, initiatedAt, timestamp, ... }`. It uses `depositId`/`withdrawalId`, which are NOT in the producer schema (the real producer emits `transferId`).

- [ ] **Step 1: Investigate what the ledger-ctrl consumer reads.** Read `record-deposit.ts` / `record-withdrawal.ts` / `event-listener.ts`. Determine which subject fields drive the LedgerEntry (amountCents? transferId? sk? idempotency key?).
  - If the consumer reads ONLY fields present in `FundingSnapshotSchema` (e.g. `amountCents`, `sk`) → migration is clean; build a full conformant `FundingSnapshot` subject.
  - If the consumer reads `depositId`/`withdrawalId` (a field the real producer does NOT emit) → that is a **latent consumer bug** (consumer reads a phantom field; works in prod only if it tolerates `undefined`). FILE it via `backlog-add` (captured under the epic, or a typed-subject-consumer-contract-gap), do NOT fix it here (production change, out of scope). Then build the conformant subject anyway (matching the real producer) and let the rank-5 runtime gate prove behavior.

- [ ] **Step 2: Migrate each flagged site** to a full conformant `FundingSnapshot`. Canonical transform for `DEPOSIT_SETTLED`:

Before:
```ts
detailType: 'DEPOSIT_SETTLED',
detail: { depositId: `dep-ddb-${Date.now()}`, amountCents: 500_000, settledAt: new Date().toISOString() },
```
After:
```ts
detailType: 'DEPOSIT_SETTLED',
subject: {
  sk: 'DEPOSIT_SETTLED',
  direction: 'DEPOSIT',
  status: 'settled',
  transferId: `dep-ddb-${Date.now()}`,
  amountCents: 500_000,
  currency: 'USD',
  executionMode: 'simulation',
  initiatedAt: new Date().toISOString(),
  settledAt: new Date().toISOString(),
  timestamp: new Date().toISOString(),
},
```
(`WITHDRAWAL_SETTLED`: `direction: 'WITHDRAWAL'`, `sk: 'WITHDRAWAL_SETTLED'`, `transferId` from the old `withdrawalId`. Preserve each site's own amount/id values. For the resilience duplicate-idempotency sites, keep the SAME `transferId`/`eventId` semantics the test relied on — read each site.)

- [ ] **Step 3: Verify the gate no longer flags ledger-ctrl + no new tsc errors**

Run: `node tools/check-typed-fixtures.mjs 2>/dev/null | grep ledger-ctrl` (expect none)
Run: `pnpm exec tsc --noEmit -p services/ledger/ledger-ctrl/tsconfig.json 2>&1 | grep -c 'error TS'` (expect baseline count, no increase)

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/test/integration/
git commit --no-verify -m "test(typed-fixtures): migrate ledger-ctrl funding-settled fixtures to typed FundingSnapshot subject"
git log --oneline -1
```

---

### Task 4: Migrate investor-bff `DEPOSIT_SETTLED` + `BROKER_CIRCUIT_OPEN`/`_CLOSED` sites

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (DEPOSIT_SETTLED ~:449,1026; BROKER_CIRCUIT_OPEN ~:1141; BROKER_CIRCUIT_CLOSED ~:1161)

**Context:**
- investor-bff `DEPOSIT_SETTLED` fixtures ALREADY carry the FundingSnapshot shape (`sk`,`direction`,`status`,`transferId`,...) with `tenantId`+`userId` in `detail`. Migration = move `tenantId`/`userId` to `context`, rename `detail`→`subject`, drop the identity keys from the subject (DRY).
- `BROKER_CIRCUIT_*` fixtures use `detail: {}` — the schema REQUIRES `{ adapter, timestamp }`, so `subject: {}` would FAIL `.parse`. Populate them (consumer ignores them; behavior unchanged).

- [ ] **Step 1: Migrate the `DEPOSIT_SETTLED` sites.** Canonical transform (~:449):

Before:
```ts
detailType: 'DEPOSIT_SETTLED',
detail: { tenantId: ctx.tenantId, userId: cognitoSub, sk: 'DEPOSIT_SETTLED', direction: 'DEPOSIT', status: 'settled', transferId, amountCents: 250_000, currency: 'USD', executionMode: 'simulation', initiatedAt: '...', detectedAt: '...', settledAt: '...', /* + __version */ },
```
After:
```ts
detailType: 'DEPOSIT_SETTLED',
context: { tenantId: ctx.tenantId, userId: cognitoSub },
subject: { sk: 'DEPOSIT_SETTLED', direction: 'DEPOSIT', status: 'settled', transferId, amountCents: 250_000, currency: 'USD', executionMode: 'simulation', initiatedAt: '...', detectedAt: '...', settledAt: '...', /* keep timestamp + __version if present */ },
```
(Keep every payload field the site already set — `timestamp`, `__version`, etc. Only move `tenantId`/`userId` to `context` and rename the key.)

- [ ] **Step 2: Migrate the `BROKER_CIRCUIT_OPEN` / `BROKER_CIRCUIT_CLOSED` sites:**

Before:
```ts
detailType: 'BROKER_CIRCUIT_OPEN',
detail: {},
```
After:
```ts
detailType: 'BROKER_CIRCUIT_OPEN',
subject: { adapter: 'alpaca', timestamp: new Date().toISOString() },
```
(Same for `BROKER_CIRCUIT_CLOSED`.)

- [ ] **Step 3: Verify the gate no longer flags investor-bff + no new tsc errors**

Run: `node tools/check-typed-fixtures.mjs 2>/dev/null | grep investor-bff` (expect none)
Run: `pnpm exec tsc --noEmit -p services/investor/investor-bff/tsconfig.json 2>&1 | grep -c 'error TS'`
Expected: same as the pre-migration baseline (investor-bff has known latent errors per [[investor-services-latent-tsc-errors]] — the count must NOT increase).

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/test/integration/
git commit --no-verify -m "test(typed-fixtures): migrate investor-bff funding + circuit fixtures to typed subject"
git log --oneline -1
```

---

### Task 5: Full static validation + ship

**Files:**
- Modify: `docs/backlog/typed-test-fixtures-cross-domain-consumer-migration.md` (ship)

- [ ] **Step 1: Gate is fully clean for the 6 events**

Run: `node tools/check-typed-fixtures.mjs; echo "exit=$?"`
Expected: the 6 events produce ZERO violations. (Any remaining violations are for OTHER events / OTHER items — confirm none of the 6 appear.)

- [ ] **Step 2: Registry sync + affected unit + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: PASS. (Includes `test-contracts:test` registry sync. The integration test files are not run here — their compile-safety is the tsc check below; runtime is rank-5.)

- [ ] **Step 3: Per-service tsc error counts unchanged** for reconciliation-ctrl, ledger-ctrl, investor-bff (compare to `origin/main` baselines; migrated subject lines add zero errors).

- [ ] **Step 4: Ship the backlog item.** Set `status: shipped`, fill `validation_gate:` with the gate output + commit SHAs + the affected test/lint result. Run `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit both.

- [ ] **Step 5:** Route to `superpowers:finishing-a-development-branch` (per `/backlog-next` closing phase 6.7), then worktree cleanup (6.8).

## Self-Review notes

- **Spec coverage:** the epic design (`2026-06-16-typed-test-fixtures-design.md`) requires producer event→schema registration + typed putEvent migration + gate enforcement — Tasks 1 (register+JSON), 2–4 (migrate), 5 (gate). ✓
- **`BROKER_HEAL_ESCALATED`** is registered (Task 1) but has NO static consumer `putEvent` site (only `fakeSqsRecord` unit + dynamic `it.each`), so no Task-2/3/4 migration row — registration alone is correct and required for the rank-4 dynamic-gate work.
- **Type consistency:** producer schemas are imported from each producer's existing `/contracts` (or `/domain` for FundingSnapshot) — no new schema definitions, no renames.
