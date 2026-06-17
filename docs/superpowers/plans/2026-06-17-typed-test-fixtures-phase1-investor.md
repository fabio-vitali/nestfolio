# Typed Test Fixtures — Phase 1 (Investor Domain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the Investor-domain producers' event→schema maps and migrate every test fixture call-site that emits an **investor-produced** event to the typed `putEvent({ subject, context })` API, so a co-wrong investor fixture becomes a compile error; then convert the regression gate to a **registry-driven** scan that forbids legacy `detail:` for any registered event name across all test files.

**Architecture:** Phase 0 already shipped the mechanism — `@nestfolio/test-contracts` composes producer-owned `*EventSubjects` maps into a single `EventSubjects` registry; `EventBridgeClient.putEvent` has a typed overload `putEvent<K extends RegisteredEventName>({ detailType: K, subject: SubjectOf<K>, context? })` with a runtime `EventSubjects[detailType].parse(subject)` backstop. Phase 1 extends the registry with the Investor producers' maps and migrates only the call-sites whose `detailType` is investor-produced (**per-producer migration**, per the 2026-06-17 user decision). Investor test *files* stay mixed (legacy for not-yet-registered cross-domain events) until Phases 2–4. The gate is reworked from directory-scoped to **registry-driven**: it flags a legacy `putEvent({…detail:…})` whenever the call's `detailType` resolves to a name in the registry — auto-scoping by what's been migrated, covering the shared `apps/e2e-feature-tests` app, and self-extending each future phase.

**Tech Stack:** TypeScript, zod (producer contracts), Jest (ts-jest, ESM via `--experimental-vm-modules`), nx, `@nestfolio/test-support` (`EventBridgeClient`), `@nestfolio/test-contracts` (registry), pure-Node gate script (`tools/check-typed-fixtures.mjs`) wired into `scripts/verify-structure.sh` Check 9.

**Validation model (spec §8):** This is a refactor, not greenfield. The "failing test" for each migration task is `tsc --noEmit` surfacing the co-wrong fixture as a compile error (or a clean compile after a correct migration); the "passing test" is a clean `tsc --noEmit` + the domain's existing integration/e2e suites staying green against deployed dev. No production code changes — latent producer/consumer bugs surfaced are filed via `backlog-add` (spec §7).

> **Worktree:** All work happens in `.claude/worktrees/typed-test-fixtures-phase1-investor` on branch `worktree-typed-test-fixtures-phase1-investor`. Commit with `--no-verify` (the pre-commit hook can't run nx-affected inside a worktree) and verify each commit landed. **Verify all fixture-touching lint with `--skip-nx-cache`** (spec §5 CORRECTION: the nx cache masked a test-only circular dependency in Phase 0).

---

## Per-event registration table (the source of truth for "migrate vs defer")

A call-site migrates in Phase 1 **iff** its `detailType` is in this "Phase 1 — register" set. Everything else stays legacy until its producer's phase.

| Event name | Producer (domain) | Subject schema | Schema location | Phase 1? |
|---|---|---|---|---|
| `MANDATE_ISSUED` | investor-bff (Investor) | `MandateSchema` | `investor-adpt/src/domain/contracts.ts` | ✅ already registered (`mandateEventSubjects`) |
| `MANDATE_REVOKED` | investor-bff | `MandateSchema` | ″ | ✅ already registered |
| `MANDATE_REAFFIRMED` | investor-bff | `MandateSchema` | ″ | ✅ already registered |
| `OPERATING_MODE_CHANGED` | investor-bff | `MandateSchema` | ″ | ✅ already registered |
| `INVESTOR_PROFILE_CREATED` | investor-bff | `InvestorProfileUpdatedSchema` | `investor-bff/src/domain/contracts.ts:31` | ➕ register (Task 1) |
| `INVESTOR_PROFILE_UPDATED` | investor-bff | `InvestorProfileUpdatedSchema` | ″ | ➕ register (Task 1) |
| `GOAL_UPDATED` | investor-bff | `InvestorProfileUpdatedSchema` | ″ (CDC onFieldChange:goal of the InvestorProfile row) | ➕ register (Task 1) |
| `NOTIFICATION_READ` | investor-bff | `NotificationReadSchema` | `investor-bff/src/domain/contracts.ts:46` | ➕ register (Task 1) |
| `ONBOARDING_COMPLETED` | onboarding-bff | `OnboardingCompletedRecordSchema` | `onboarding-bff/src/domain/schemas.ts:40` (re-exported via `…/contracts`) | ➕ register (Task 1) |
| `NOTIFICATION_CREATED` | investor-ctrl | `NotificationCreatedSchema` | `investor-ctrl/src/domain/contracts.ts:7` | ➕ register (Task 1) |
| `NOTIFICATION_UPDATED` | investor-ctrl | `NotificationCreatedSchema` | ″ | ➕ register (Task 1) |
| `MONTHLY_REPORT_CREATED` | investor-ctrl | `MonthlyReportSchema` | `investor-ctrl/src/domain/contracts.ts:24` | ➕ register (Task 1) |
| `MONTHLY_REPORT_UPDATED` | investor-ctrl | `MonthlyReportSchema` | ″ | ➕ register (Task 1) |
| `DEPOSIT_INITIATED` | investor-bff | `DepositInitiatedSchema` | `investor-adpt/src/domain/contracts.ts:15` | ➕ register (Task 1) |
| `WITHDRAWAL_INITIATED` | investor-bff | `WithdrawalInitiatedSchema` | `investor-adpt/src/domain/contracts.ts:35` | ➕ register (Task 1) |
| `EXECUTION_MODE_CHANGED` | investor-bff | `ExecutionModeChangedSchema` | `investor-adpt/src/domain/contracts.ts:74` | ➕ register (Task 1) |
| `EXECUTION_MODE_CHANGE_UPDATED` | investor-bff | `ExecutionModeChangedSchema` | ″ | ➕ register (Task 1) |
| `USER_REGISTERED` | investor-web (Investor) | — none (inlined `{ userId, tenantId, email }`) | investor-web has **no contracts surface** | ⛔ DEFER + file (Task 6) |
| `USER_AUTHENTICATED` | investor-web | — none | ″ | ⛔ DEFER + file (Task 6) |
| `ORDER_FILLED`, `ORDER_REJECTED` | execution | — | — | ⛔ Phase 3 |
| `DECISION_APPROVED`, `DECISION_BLOCKED`, `DECISION_PACKET_CREATED/UPDATED` | advisory | — | — | ⛔ Phase 2 |
| `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `WITHDRAWAL_SETTLED` | ledger | — | — | ⛔ Phase 4 |
| `BROKER_CIRCUIT_*` | execution | — | — | ⛔ Phase 3 |

---

## The canonical transform (apply to every migrating call-site)

**Before (legacy):**
```ts
await eb.putEvent({
  bus: 'investor',
  targetService: 'dashboard-bff',
  detailType: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
  detail: {
    tenantId: tenant.tenantId,   // identity — MOVE to context
    userId: tenant.userId,       // identity — MOVE to context
    operatingMode: 'BALANCED',
    goal: { objective: 'GROWTH', targetAmountCents: 1_000_000 },
    riskProfile: { score: 3 },
    onboardingCompletedAt: '2026-01-15T00:00:00.000Z',
    __version: 2,
  },
});
```

**After (typed):**
```ts
await eb.putEvent({
  bus: 'investor',
  targetService: 'dashboard-bff',
  detailType: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
  subject: {
    operatingMode: 'BALANCED',
    goal: { objective: 'GROWTH', targetAmountCents: 1_000_000 },
    riskProfile: { score: 3 },
    onboardingCompletedAt: '2026-01-15T00:00:00.000Z',
    __version: 2,
  },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```

**Rules:**
1. Rename the `detail:` key to `subject:`.
2. Remove `tenantId`, `userId`, `region` from the payload and pass them in `context: { … }` (omit `context` entirely if the test used only the shared `ctx` identity and passed no per-test override).
3. Remove any field NOT in the registered schema (excess-property compile error). These are the **(a) co-wrong** fixes — record each in the Task notes.
4. If a *required* schema field is missing, add it with a realistic value. If the value is genuinely unknowable because the **real producer also omits it**, that is a **(b) latent contract bug** — file via `backlog-add`, keep the call-site legacy, and reference the filed id in a comment (spec §7).
5. `detailType` stays exactly as-is (the typed overload infers `K` from it; a string literal or a `XxxEventTypes.NAME` constant both resolve).

---

### Task 1: Register the Investor producer event→schema maps

**Files:**
- Modify: `services/investor/investor-bff/src/domain/contracts.ts` (add `investorBffEventSubjects`)
- Modify: `services/investor/onboarding-bff/src/domain/contracts.ts` (add `onboardingBffEventSubjects`)
- Modify: `services/investor/investor-ctrl/src/domain/contracts.ts` (add `investorCtrlEventSubjects`)
- Modify: `services/investor/investor-adpt/src/domain/contracts.ts` (add `investorFundingEventSubjects`) + `services/investor/investor-adpt/src/domain/index.ts` (re-export it)
- Modify: `libs/test-contracts/src/index.ts` (compose all four new maps)
- Test: `libs/test-contracts/test/registry.test.ts` (new)

- [ ] **Step 1: Add `investorBffEventSubjects` to investor-bff contracts**

Append to `services/investor/investor-bff/src/domain/contracts.ts` (file currently imports only `zod`; add the `ZodTypeAny` type import at the top):

```ts
import type { ZodTypeAny } from 'zod';

// … existing schemas (InvestorProfileUpdatedSchema, NotificationReadSchema) …

/**
 * Test-fixture event→subject map for investor-bff's own CDC emissions.
 * Mandate / Deposit / Withdrawal / ExecutionMode events are cross-domain and live in
 * investor-adpt/domain (mandateEventSubjects + investorFundingEventSubjects); the
 * INVESTOR_PROFILE_* / GOAL_UPDATED / NOTIFICATION_READ subjects are intra-domain and
 * homed here. Consumed only by `@nestfolio/test-contracts`.
 */
export const investorBffEventSubjects = {
  INVESTOR_PROFILE_CREATED: InvestorProfileUpdatedSchema,
  INVESTOR_PROFILE_UPDATED: InvestorProfileUpdatedSchema,
  GOAL_UPDATED: InvestorProfileUpdatedSchema,
  NOTIFICATION_READ: NotificationReadSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Add `onboardingBffEventSubjects` to onboarding-bff contracts**

Replace `services/investor/onboarding-bff/src/domain/contracts.ts` body so it also exports the map (the file already re-exports `OnboardingCompletedRecordSchema` from `./schemas`):

```ts
import type { ZodTypeAny } from 'zod';
import { OnboardingCompletedRecordSchema } from './schemas';

export {
  OnboardingCompletedRecordSchema,
  type OnboardingCompletedRecord,
} from './schemas';

/** Test-fixture event→subject map for onboarding-bff. Consumed only by @nestfolio/test-contracts. */
export const onboardingBffEventSubjects = {
  ONBOARDING_COMPLETED: OnboardingCompletedRecordSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 3: Add `investorCtrlEventSubjects` to investor-ctrl contracts**

Append to `services/investor/investor-ctrl/src/domain/contracts.ts` (add the `ZodTypeAny` type import):

```ts
import type { ZodTypeAny } from 'zod';

// … existing NotificationCreatedSchema, MonthlyReportSchema …

export const investorCtrlEventSubjects = {
  NOTIFICATION_CREATED: NotificationCreatedSchema,
  NOTIFICATION_UPDATED: NotificationCreatedSchema,
  MONTHLY_REPORT_CREATED: MonthlyReportSchema,
  MONTHLY_REPORT_UPDATED: MonthlyReportSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 4: Add `investorFundingEventSubjects` to investor-adpt and re-export it**

Append to `services/investor/investor-adpt/src/domain/contracts.ts` (already imports `ZodTypeAny`; `mandateEventSubjects` already exists there):

```ts
/**
 * Test-fixture event→subject map for the investor-produced, cross-domain-consumed
 * funding / execution-mode events whose contracts live here (the producer-adapter home).
 * MANDATE_* lives in mandateEventSubjects (above). Consumed only by @nestfolio/test-contracts.
 */
export const investorFundingEventSubjects = {
  DEPOSIT_INITIATED: DepositInitiatedSchema,
  WITHDRAWAL_INITIATED: WithdrawalInitiatedSchema,
  EXECUTION_MODE_CHANGED: ExecutionModeChangedSchema,
  EXECUTION_MODE_CHANGE_UPDATED: ExecutionModeChangedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

Add `investorFundingEventSubjects` to the existing `export { … } from './contracts';` block in `services/investor/investor-adpt/src/domain/index.ts` (alongside `mandateEventSubjects`).

- [ ] **Step 5: Compose the four maps into the registry**

Edit `libs/test-contracts/src/index.ts`:

```ts
import type { z, ZodTypeAny } from 'zod';
import { mandateEventSubjects, investorFundingEventSubjects } from '@nestfolio/investor-adpt/domain';
import { investorBffEventSubjects } from '@nestfolio/investor-bff/contracts';
import { onboardingBffEventSubjects } from '@nestfolio/onboarding-bff/contracts';
import { investorCtrlEventSubjects } from '@nestfolio/investor-ctrl/contracts';
import { decisionWorkflowEventSubjects } from '@nestfolio/decision-workflow-ctrl/contracts';

export const EventSubjects = {
  ...mandateEventSubjects,
  ...investorFundingEventSubjects,
  ...investorBffEventSubjects,
  ...onboardingBffEventSubjects,
  ...investorCtrlEventSubjects,
  ...decisionWorkflowEventSubjects,
} as const satisfies Record<string, ZodTypeAny>;

export type RegisteredEventName = keyof typeof EventSubjects;
export type SubjectOf<K extends RegisteredEventName> = z.infer<(typeof EventSubjects)[K]>;
```

- [ ] **Step 6: Write a registry test that pins the registered names**

Create `libs/test-contracts/test/registry.test.ts`:

```ts
import { EventSubjects } from '../src';

// Pins the registry contents so adding/removing a producer map is a deliberate, reviewed
// change — and so tools/typed-fixture-registered-events.json (the gate's name source) can be
// asserted in sync (see check-typed-fixtures Task 5). Update both together.
const EXPECTED = [
  'DEPOSIT_INITIATED',
  'EXECUTION_MODE_CHANGED',
  'EXECUTION_MODE_CHANGE_UPDATED',
  'GOAL_UPDATED',
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'MANDATE_ISSUED',
  'MANDATE_REAFFIRMED',
  'MANDATE_REVOKED',
  'MONTHLY_REPORT_CREATED',
  'MONTHLY_REPORT_UPDATED',
  'NOTIFICATION_CREATED',
  'NOTIFICATION_READ',
  'NOTIFICATION_UPDATED',
  'ONBOARDING_COMPLETED',
  'OPERATING_MODE_CHANGED',
  'RECOMMENDATION_PROPOSED',
  'WITHDRAWAL_INITIATED',
].sort();

it('registry contains exactly the migrated event names', () => {
  expect(Object.keys(EventSubjects).sort()).toEqual(EXPECTED);
});
```

- [ ] **Step 7: Verify compile + registry test**

Run: `pnpm exec tsc -p libs/test-contracts/tsconfig.lib.json --noEmit` (expected: exit 0) and `pnpm nx test test-contracts --skip-nx-cache` (expected: registry test PASS).
If `tsc` errors that a `@nestfolio/<svc>/contracts` subpath is unresolved, confirm the subpath exists in `tsconfig.base.json` `paths` (investor-bff/onboarding-bff/investor-ctrl `/contracts` + investor-adpt `/domain` all already exist per discovery); the jest mapper auto-derives from it (`jest.preset.js` `pathsToModuleNameMapper`).

- [ ] **Step 8: Commit**

```bash
git add services/investor/*/src/domain/contracts.ts services/investor/onboarding-bff/src/domain/contracts.ts services/investor/investor-adpt/src/domain/index.ts libs/test-contracts/src/index.ts libs/test-contracts/test/registry.test.ts
git commit --no-verify -m "feat(test-contracts): register Investor-domain producer event-subject maps (Phase 1)"
```

---

### Task 2: Migrate the shared e2e fixtures (`apps/e2e-feature-tests/src/helpers/fixtures.ts`)

These are the highest-leverage helpers (used by many scenarios). Migrate **only** the investor-produced emissions; leave the cross-domain ones legacy.

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`
- Check after: `apps/e2e-feature-tests/src/helpers/fixtures.test.ts` (unit tests of the fixtures — must still pass)

| Line (approx) | Event | Action |
|---|---|---|
| 72 | `USER_REGISTERED` | **leave legacy** (deferred, Task 6) |
| 82 | `ONBOARDING_COMPLETED` | **migrate** |
| 185 | `BALANCE_UPDATED` (`funded()`) | leave legacy (ledger, Phase 4) |
| 257 | `DECISION_PACKET_CREATED/UPDATED` (`emitDecisionSnapshot()`) | leave legacy (advisory, Phase 2) |
| 348 | `MANDATE_ISSUED` (`withLiveDecision()`) | **migrate — co-wrong (a): drop excess fields** |
| 369 | `INVESTOR_PROFILE_UPDATED` (`withLiveDecision()`) | **migrate** |
| 437 | `NOTIFICATION_CREATED` (`withNotification()`) | **migrate** |
| 466 | `ORDER_FILLED` (`withHoldings()`) | leave legacy (execution, Phase 3) |

- [ ] **Step 1: Migrate `onboarded()` → ONBOARDING_COMPLETED (line ~82)**

Apply the canonical transform. The `OnboardingCompletedRecordSchema` subject is:
`{ email?, goal: { objective: string }, horizonYears, accountMode: 'simulation'|'live', capitalAmount, currency, riskTolerance: number, riskExperience: number, operatingMode, mandateLevel?: 'ADVISORY'|'DISCRETIONARY', mandateAccepted: true }`.
Move `tenantId`/`userId` to `context`. If the fixture currently passes `goal` as a bare string, shape it as `{ objective: <value> }`. Keep `mandateLevel` (it is honored — see `onboarding-mandatelevel-contract-gap`, shipped). Result:

```ts
await eb.putEvent({
  bus: 'investor',
  targetService: 'investor-bff',
  detailType: OnboardingBffEventTypes.ONBOARDING_COMPLETED,
  subject: {
    goal: { objective: opts.goal ?? 'RETIREMENT' },
    horizonYears: opts.horizonYears ?? 20,
    accountMode: opts.accountMode ?? 'simulation',
    capitalAmount: opts.capitalAmount ?? 100_000,
    currency: 'USD',
    riskTolerance: opts.riskTolerance ?? 2,
    riskExperience: opts.riskExperience ?? 2,
    operatingMode: opts.operatingMode ?? 'BALANCED',
    mandateLevel: opts.mandateLevel ?? 'DISCRETIONARY',
    mandateAccepted: true,
  },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```
(Use the fixture's existing local variable names for the opts/defaults — match what `onboarded()` already reads.)

- [ ] **Step 2: Migrate `withLiveDecision()` → MANDATE_ISSUED (line ~348) — co-wrong fix**

`MandateSchema` = `{ mandateId, level: 'ADVISORY'|'DISCRETIONARY', status: 'ACTIVE'|'REVOKED', operatingMode, effectiveDate, revokedAt?, __version? }`. The current fixture additionally passes `monthlyTurnoverCapPercent`, `maxSingleTradePercent`, `rebalanceCadence` — **NOT in the schema** (they are derived at compliance eval-time via `resolveGuardrailParams(operatingMode)`, never carried on the Mandate subject). **Drop all three** (the (a) fix). Move identity to context:

```ts
await eb.putEvent({
  bus: 'investor',
  targetService: 'compliance-ctrl',
  detailType: InvestorAdptEventTypes.MANDATE_ISSUED, // or the constant the fixture already uses
  subject: {
    mandateId,
    level: 'DISCRETIONARY',
    status: 'ACTIVE',
    operatingMode: opts.operatingMode ?? 'BALANCED',
    effectiveDate: '2026-01-15T00:00:00.000Z',
  },
  context: { tenantId: tenant.tenantId, userId: tenant.userId },
});
```
Record in commit notes: "(a) MANDATE_ISSUED fixture dropped 3 non-schema guardrail fields."

- [ ] **Step 3: Migrate `withLiveDecision()` → INVESTOR_PROFILE_UPDATED (line ~369)**

Apply the canonical transform against `InvestorProfileUpdatedSchema` = `{ operatingMode, executionMode?, goal: { objective, timeHorizonMonths?, targetAmountCents?, currency?, targetReturn? }, riskProfile: { score, band?, toleranceResponse?, experienceLevel? }, onboardingCompletedAt?, __version? }`. Drop any field outside this shape; move identity to context.

- [ ] **Step 4: Migrate `withNotification()` → NOTIFICATION_CREATED (line ~437)**

`NotificationCreatedSchema` = `{ notificationId, channel, title, body, relatedEntityType, relatedEntityId }`. Move identity to context; drop any extra field.

- [ ] **Step 5: Compile check**

Run: `pnpm exec tsc -p apps/e2e-feature-tests/tsconfig.spec.json --noEmit` (expected: exit 0). Any error here is a still-unmigrated co-wrong field — fix per the transform rules.

- [ ] **Step 6: Run the fixtures unit test**

Run: `pnpm nx test e2e-feature-tests --skip-nx-cache -- --testPathPatterns=helpers/fixtures` if such a unit target exists, else `JEST_PATH='helpers/fixtures' pnpm nx run e2e-feature-tests:test-e2e-features` is NOT appropriate (that hits AWS). The `fixtures.test.ts` unit tests run under the normal jest unit config — confirm the project's unit test target name first with `node -e "console.log(Object.keys(require('./apps/e2e-feature-tests/project.json').targets))"`. Expected: fixtures unit tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit --no-verify -m "refactor(e2e): migrate Investor-produced emissions in shared fixtures to typed putEvent"
```

---

### Task 3: Migrate investor service integration test call-sites

**Files (migrate investor-produced events only; leave cross-domain legacy):**
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` — NOTIFICATION_CREATED (~159), ONBOARDING_COMPLETED (~217), INVESTOR_PROFILE_* / GOAL_UPDATED / MANDATE_* / DEPOSIT_INITIATED / EXECUTION_MODE_* wherever they appear (~416/449/483/516/876/1028/1143/1163 — classify each by detailType). **USER_REGISTERED (~97, ~206) stays legacy.**
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` — INVESTOR_PROFILE_CREATED (~40), INVESTOR_PROFILE_UPDATED (~73), and other investor-profile emissions. **PORTFOLIO_UPDATED (~106) and BALANCE_UPDATED stay legacy (ledger, Phase 4).**
- `services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts` — BALANCE_UPDATED / PORTFOLIO_UPDATED via `snapshotDetail()` → **stay legacy** (ledger).
- `services/investor/investor-ctrl/test/integration/investor-ctrl.resilience.integration.test.ts` — ONBOARDING_COMPLETED (~131/140, and `onboardEvent` ~179). **ORDER_FILLED (~75/94, `fillEvent`) stays legacy (execution).**
- `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` — **the parametrized `it.each` at ~119 stays legacy in full**: it drives a *dynamic* `detailType` from a 12-row table spanning 4 domains through one `putEvent`. Typing it requires a literal `K` per call and all 12 producers registered; restructuring + cross-domain registration is out of Phase 1 scope. Add a one-line comment above the loop: `// TODO(typed-test-fixtures Phase 4): table mixes cross-domain events + dynamic detailType; migrate once all producers are registered.` ORDER_FILLED (~142) and BROKER_CIRCUIT_* (~197) also stay legacy.

- [ ] **Step 1: investor-bff.integration.test.ts — migrate the investor-produced call-sites**

For each `putEvent` in the file, read its `detailType`. If it's in the Phase 1 register set, apply the canonical transform (subject + context, drop excess fields). These tests pervasively put `tenantId`/`userId` in `detail` — that identity moves to `context`. Leave USER_REGISTERED calls untouched.

- [ ] **Step 2: Compile + run investor-bff integration suite**

Run: `pnpm exec tsc -p services/investor/investor-bff/tsconfig.spec.json --noEmit` (exit 0), then (against deployed dev) `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-bff:test-integration --skip-nx-cache`. Expected: green (note any pre-existing flake like `investor-bff-updateoperatingmode-integration-seed-flake` and rerun once).

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit --no-verify -m "refactor(investor-bff): migrate Investor-produced integration fixtures to typed putEvent"
```

- [ ] **Step 4: dashboard-bff (both integration files) — migrate INVESTOR_PROFILE_* only**

Apply the transform to INVESTOR_PROFILE_CREATED/UPDATED. Leave PORTFOLIO_UPDATED/BALANCE_UPDATED legacy. Compile-check: `pnpm exec tsc -p services/investor/dashboard-bff/tsconfig.spec.json --noEmit`. Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run dashboard-bff:test-integration --skip-nx-cache`. Commit `refactor(dashboard-bff): migrate Investor-profile integration fixtures to typed putEvent`.

- [ ] **Step 5: investor-ctrl resilience test — migrate ONBOARDING_COMPLETED only; comment the parametrized loop**

Migrate the ONBOARDING_COMPLETED emissions; add the TODO comment above the `onboarding-notification` parametrized loop. Compile-check: `pnpm exec tsc -p services/investor/investor-ctrl/tsconfig.spec.json --noEmit`. Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-ctrl:test-integration --skip-nx-cache`. Commit `refactor(investor-ctrl): migrate ONBOARDING_COMPLETED integration fixtures to typed putEvent`.

---

### Task 4: Migrate remaining e2e scenario call-sites for investor events

**Files:** any `apps/e2e-feature-tests/src/**/*.e2e.test.ts` that emits an investor-produced event directly (not via the shared fixtures) — e.g. `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts` (~80) and any profile/advisory/funding scenario that fires MANDATE_*, INVESTOR_PROFILE_*, ONBOARDING_COMPLETED, DEPOSIT_INITIATED, EXECUTION_MODE_* directly.

- [ ] **Step 1: Enumerate the remaining sites**

Run: `rg -n "putEvent" apps/e2e-feature-tests/src --glob '!helpers/fixtures.ts'` and classify each call's `detailType` against the Phase 1 register table.

- [ ] **Step 2: Migrate each investor-produced site** via the canonical transform. `operating-mode-authority.e2e.test.ts` and `update-operating-mode.e2e.test.ts` are already typed (RECOMMENDATION_PROPOSED) — skip; they are advisory anyway.

- [ ] **Step 3: Compile check**

Run: `pnpm exec tsc -p apps/e2e-feature-tests/tsconfig.spec.json --noEmit` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src
git commit --no-verify -m "refactor(e2e): migrate remaining Investor-event scenario fixtures to typed putEvent"
```

---

### Task 5: Rework the regression gate to registry-driven

**Files:**
- Create: `tools/typed-fixture-registered-events.json` (the gate's name source)
- Modify: `tools/check-typed-fixtures.mjs`
- Modify: `libs/test-contracts/test/registry.test.ts` (assert JSON ↔ registry in sync)

- [ ] **Step 1: Create the registered-names JSON**

`tools/typed-fixture-registered-events.json` — the exact `Object.keys(EventSubjects)` (the 18 names from Task 1's `EXPECTED`). This is what the pure-Node gate reads (it cannot import the TS registry).

```json
{
  "registeredEvents": [
    "DEPOSIT_INITIATED","EXECUTION_MODE_CHANGED","EXECUTION_MODE_CHANGE_UPDATED",
    "GOAL_UPDATED","INVESTOR_PROFILE_CREATED","INVESTOR_PROFILE_UPDATED",
    "MANDATE_ISSUED","MANDATE_REAFFIRMED","MANDATE_REVOKED","MONTHLY_REPORT_CREATED",
    "MONTHLY_REPORT_UPDATED","NOTIFICATION_CREATED","NOTIFICATION_READ","NOTIFICATION_UPDATED",
    "ONBOARDING_COMPLETED","OPERATING_MODE_CHANGED","RECOMMENDATION_PROPOSED","WITHDRAWAL_INITIATED"
  ]
}
```

- [ ] **Step 2: Assert the JSON stays in sync with the registry**

Add to `libs/test-contracts/test/registry.test.ts`:

```ts
import registered from '../../../tools/typed-fixture-registered-events.json';

it('gate name-source matches the registry', () => {
  expect([...registered.registeredEvents].sort()).toEqual(Object.keys(EventSubjects).sort());
});
```
(Adjust the relative path / use a jest moduleNameMapper-safe import; if JSON import resolution is awkward, `fs.readFileSync` the file relative to `process.cwd()`.)

- [ ] **Step 3: Rework `check-typed-fixtures.mjs` to scan all test files, name-scoped**

Change the gate from `migratedDirs` (dir-scoped) to: walk every `*.test.ts`/`*.spec.ts` under `services/**/test`, `libs/**/test`, and `apps/e2e-feature-tests/src`; for each `putEvent({ … })` call that contains a `detail:` key, extract the `detailType` value's **trailing name** (the substring after the last `.` for `Xxx.NAME`, or the string-literal contents) and flag it **iff** that name is in `registeredEvents`. Skip calls whose `detailType` is a *dynamic* expression that yields no resolvable trailing name (e.g. a loop variable) — emit a `// note:` to stderr listing skipped dynamic sites so they are not silently ignored (no-silent-truncation). Keep the existing `.subject as` cast check, but also name-scope it where a sibling `detailType` is resolvable.

Pseudo-shape of the new core:
```js
const { registeredEvents } = JSON.parse(fs.readFileSync('tools/typed-fixture-registered-events.json', 'utf8'));
const REGISTERED = new Set(registeredEvents);
// for each putEvent block with a detail: key →
//   const name = extractTrailingName(detailTypeExpr); // after last '.', or string literal
//   if (name && REGISTERED.has(name)) violations.push({file, line, name});
//   else if (!name) skipped.push({file, line, detailTypeExpr});
```

- [ ] **Step 4: Self-test the gate (must catch a legacy registered-event fixture, must ignore an unregistered one)**

Run: `node tools/check-typed-fixtures.mjs`; expected exit 0 now (all registered-event fixtures migrated in Tasks 2–4). Then temporarily revert one migrated call (e.g. re-add `detail:` to a MANDATE_ISSUED site), re-run, confirm it FAILS naming that site, then restore. Confirm a known legacy unregistered site (e.g. ORDER_FILLED in `withHoldings`) is NOT flagged.

- [ ] **Step 5: Confirm the pre-commit wiring still invokes it**

Check `scripts/verify-structure.sh` Check 9 still calls `node tools/check-typed-fixtures.mjs` (no path arg needed now). No change expected; if Check 9 passed a dir arg, remove it.

- [ ] **Step 6: Commit**

```bash
git add tools/check-typed-fixtures.mjs tools/typed-fixture-registered-events.json libs/test-contracts/test/registry.test.ts
git commit --no-verify -m "feat(gate): registry-driven typed-fixture check (forbids legacy detail: for any registered event)"
```

---

### Task 6: File deferred items + surfaced latent (b) bugs

- [ ] **Step 1: File the investor-web contracts-surface gap**

Use `backlog-add`: "investor-web produces USER_REGISTERED / USER_AUTHENTICATED but has no contracts surface (no package.json/exports, no src/domain) — these events have no producer-owned zod schema, so their fixtures can't be typed. Stand up a minimal `@nestfolio/investor-web/contracts` (or relocate the subject to a producer-owned home) so USER_REGISTERED/USER_AUTHENTICATED join the registry." Tag it as a typed-test-fixtures follow-up (epic member or captured), not Phase 1 scope.

- [ ] **Step 2: File any (b) latent contract bug surfaced during Tasks 2–4**

For each migration where a *required* schema field was genuinely absent from the real producer emission (not just the fixture), file via `backlog-add` with the producer + field. (Known candidate from discovery, but it is a *ledger* event so it surfaces in Phase 4, not here: `onboarding-notification` BALANCE_UPDATED omits the required `snapshot` — do NOT file under Phase 1.) If Tasks 2–4 surface none, note "0 (b) bugs" in the ship validation_gate.

- [ ] **Step 3: Log the (a)/(b) split** (spec §7) in the eventual ship `validation_gate`: count of fixtures corrected (a) vs latent bugs filed (b), plus the count of call-sites migrated vs deferred-by-domain.

---

### Task 7: Full validation

- [ ] **Step 1: Whole-domain typecheck**

Run `pnpm exec tsc --noEmit` on each touched spec tsconfig (investor-bff, dashboard-bff, investor-ctrl, e2e-feature-tests, test-contracts). All exit 0.

- [ ] **Step 2: Affected lint with cache OFF (spec §5 CORRECTION)**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t lint -p "$AFFECTED" --skip-nx-cache
```
Expected: 0 errors (watch specifically for any `test-contracts` circular-dependency error — `eslint.config.js` already carries `ignoredCircularDependencies: [['test-contracts','*']]`, so it should stay green; if a NEW cycle appears, it means a producer map imported something heavy — keep maps zod-only).

- [ ] **Step 3: Affected unit tests**

```bash
pnpm nx run-many -t test -p "$AFFECTED" --skip-nx-cache
```
Expected: green (note the known pre-existing `agent-orchestrator @smithy` worktree-symlink false-FAIL if it appears — unrelated).

- [ ] **Step 4: Investor integration suites (deployed dev — no deploy needed, test-layer only)**

```bash
INTEG=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration -p "$INTEG" --skip-nx-cache
```
Expected: green. Treat any fail-then-pass as a real failure: pull CloudWatch from the failing window before continuing, rerun once to confirm (flake-means-broken).

- [ ] **Step 5: Involved e2e scenarios only (NOT the full suite, NOT Playwright)**

Re-run the investor-touching scenarios whose fixtures changed — at minimum the ones using `onboarded()`/`withLiveDecision()`/`withNotification()` and `investor-contract-emission`. Example:
```bash
JEST_PATH='investor/|profile/|advisory/operating-mode-authority' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features
```
Expected: green. Confirm "Tests: N passed" actually ran (not zero — the run-jest launcher can false-green a bad path regex).

- [ ] **Step 6: Run the gate one final time**

Run: `node tools/check-typed-fixtures.mjs` → exit 0.

---

## Self-Review

**Spec coverage:**
- §3 mechanism reuse → Task 1 (compose producer maps into the existing registry; reuse the typed `putEvent`). ✅
- §4 "add the domain's producer maps + migrate its fixtures + fix co-wrong" → Tasks 1–4. ✅ (scoped per-producer per the 2026-06-17 user decision; cross-domain emissions in investor test files deferred to their phases — explicitly logged.)
- §6 regression gate → Task 5 (registry-driven, covers shared e2e app, self-extends). ✅
- §7 (a)/(b) triage + no silent truncation → Tasks 2/6 + the gate's skipped-dynamic-site note + the (a)/(b) split log. ✅
- §8 testing (existing suites green + compile-error proof) → Task 7 + every per-task compile check. ✅

**Placeholder scan:** Worked examples carry real schema field lists + real identifiers; the per-call-site worklist gives file:line + event + action. The few "match the fixture's existing variable names" notes are deterministic local lookups, not hand-waving. ✅

**Type consistency:** `investorBffEventSubjects` / `onboardingBffEventSubjects` / `investorCtrlEventSubjects` / `investorFundingEventSubjects` names are used identically in Task 1 and Task 5's JSON; the 18 registered names match between the registry test (Step 6), the gate JSON (Task 5), and the per-event table. ✅

## Open risks / notes for the executor
- **Parametrized `it.each` loops** (onboarding-notification) cannot be typed without restructuring + all-producer registration — deferred and commented, by design.
- **`MANDATE_ISSUED` excess-field (a) fix** is the canonical proof the typed migration catches co-wrong fixtures — keep its before/after in the commit message.
- The gate's name-source JSON is the one piece that can drift from the registry — the Task 5 Step 2 sync test is what prevents it; do not skip it.
