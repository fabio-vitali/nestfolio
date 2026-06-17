# Typed Test Fixtures — Phase 2 (Advisory Domain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit every advisory-domain test fixture from the legacy `putEvent({ detail })` form to the typed `putEvent({ subject, context })` form, so a co-wrong advisory fixture is a compile error (with a runtime `parse()` backstop).

**Architecture:** Each advisory producer exports a `<svc>EventSubjects` map (`event detailType → producer zod subject schema`) co-located with its schemas in `src/domain/contracts.ts`. `libs/test-contracts/src/index.ts` composes them into the `EventSubjects` registry. The repo-wide gate `tools/check-typed-fixtures.mjs` (driven by `tools/typed-fixture-registered-events.json`) then forbids any legacy `detail:` call-site for a registered event. We register the advisory events and migrate their fixtures in vertical slices; the gate enforces that every call-site of a registered event — **in any domain's tests** — is migrated.

**Tech Stack:** TypeScript, zod, Jest, nx, `@nestfolio/test-contracts` + `@nestfolio/test-support`.

## Global Constraints

- **Test layer only.** No production behavior changes. Adding a new `export const xEventSubjects` map (and, where missing, a new zod schema that *describes an already-emitted shape*) to a producer's `src/domain/contracts.ts` is allowed — it changes no existing export and no emission. Precedent: Phase 0 added `DecisionCycleStartedSchema` for an SF-direct event. (spec §2 non-goals, §3.1)
- **DRY subjects.** Identity (`tenantId`/`userId`/`region`) lives in the event **context**, never the subject. A typed `subject` carrying an identity field is an excess-property compile error — that is the point. Move identity to the `context:` param. (spec §3.3)
- **Schemas describe the REAL producer, not the fixture.** When authoring a new schema, read the actual producer emission and model THAT (the standing `event-subject-contracts` lesson: "validate vs the REAL producer, not fixtures"). If a fixture's fields disagree with the real producer, that is the bug the compiler surfaces.
- **Bug triage (spec §7).** Each compiler-surfaced co-wrong fixture is **(a) fixture-only** → fix the fixture; or **(b) latent contract bug** (the fixture hid a real producer/consumer mismatch) → file via the `backlog-add` skill, do NOT fix production here. **Log the running (a)/(b) count** — no silent truncation.
- **Migrate registered events repo-wide.** When you register an advisory event, the repo-wide gate flags EVERY un-migrated call-site of it, including in `services/execution`, `services/ledger`, `services/investor`, and `apps/`. Migrate them all in this phase (Phase 1 precedent: investor events were migrated inside advisory + execution test files). The gate is the completeness safety-net — a slice is done only when the gate is green for its events.
- **Lint with `--skip-nx-cache`.** The nx cache masks the test-only circular dependency the registry introduces (spec §5 CORRECTION). Always verify fixture-touching lint with `pnpm nx lint <proj> --skip-nx-cache`.
- **Runtime verification is DECOUPLED.** Do NOT gate this phase on a full deployed-dev integration/e2e run. Per the epic, the consolidated deployed-dev run is owned by the member `typed-test-fixtures-consolidated-integration-e2e-verify`. Phase 2's validation gate is static: `tsc --noEmit`, `tools/check-typed-fixtures.mjs`, `libs/test-contracts` unit (`registry.test.ts`), and `lint --skip-nx-cache`. No deploy is required (schema-map additions are test-consumed; they change no handler or emission).
- **Out of scope:** compliance-ctrl fixtures already migrated in Phase 0 (its consumed events `RECOMMENDATION_PROPOSED`/mandate are already typed); Investor/Execution/Ledger *producer* events (Phases 1/3/4) — advisory fixtures emitting those (e.g. `ORDER_FILLED`, `PORTFOLIO_UPDATED`, `DEPOSIT_DETECTED`) stay legacy until their producer's phase (the gate won't flag them while unregistered).

---

## Canonical pattern (read before Task 1)

These are the exact shapes Phase 0/1 shipped. Copy them.

**A producer event-subject map** (`services/.../src/domain/contracts.ts`, appended after the schemas):

```ts
import type { ZodTypeAny } from 'zod';
// ... existing schema exports ...

/**
 * Test-fixture event→subject map for <svc>'s emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by
 * `@nestfolio/test-contracts`. Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const <svc>EventSubjects = {
  EVENT_NAME_A: SchemaA,
  EVENT_NAME_B: SchemaB,
} as const satisfies Record<string, ZodTypeAny>;
```

**Registry composition** (`libs/test-contracts/src/index.ts`): add one import + one spread per new map:

```ts
import { <svc>EventSubjects } from '@nestfolio/<svc>/contracts';
// ...
export const EventSubjects = {
  ...mandateEventSubjects,
  // ... existing spreads ...
  ...<svc>EventSubjects,
} as const satisfies Record<string, ZodTypeAny>;
```

**A migrated fixture call-site** (before → after):

```ts
// BEFORE (legacy)
await eb.putEvent({
  bus: 'advisory', targetService: 'advisory-bff',
  detailType: 'DECISION_PACKET_CREATED',
  detail: { tenantId: ctx.tenantId, decisionId, status: 'GENERATING', /* ... */ },
});
// AFTER (typed)
await eb.putEvent({
  bus: 'advisory', targetService: 'advisory-bff',
  detailType: 'DECISION_PACKET_CREATED',
  subject: { decisionId, status: 'GENERATING', /* DRY fields only */ },
  context: { tenantId: ctx.tenantId },   // identity moves here
});
```

---

## Shared procedures (referenced by every task)

### Procedure REG — register an event-subject map
1. Open the producer's `src/domain/contracts.ts`. Ensure `import type { ZodTypeAny } from 'zod';` is present.
2. Append the `<svc>EventSubjects` map (Canonical pattern A), mapping each event name to its existing schema (named in the task) or a new schema authored in the same task.
3. In `libs/test-contracts/src/index.ts`: add `import { <svc>EventSubjects } from '@nestfolio/<svc>/contracts';` and a `...<svc>EventSubjects` spread in `EventSubjects`.
4. Add the new event names to **both** registry-name sources, kept alphabetically sorted:
   - `tools/typed-fixture-registered-events.json` (`registeredEvents` array)
   - `libs/test-contracts/test/registry.test.ts` (`EXPECTED` array)
5. Run the registry sync test (Procedure VERIFY step 1). It fails loudly if the two name-sources drift.

### Procedure MIG — migrate a call-site
1. Change `detail:` → `subject:`.
2. Remove any identity field (`tenantId`/`userId`/`region`) from the subject; add a `context: { tenantId: ..., userId: ... }` param carrying them (only the identity fields the test actually varies).
3. Let `tsc` surface co-wrong fields. For each: classify **(a)** (fix the fixture to satisfy the schema) or **(b)** (real producer/consumer mismatch → `backlog-add`, leave the fixture matching real producer, reference the filed id in a comment). Record the (a)/(b) tally in the task's commit body.
4. A call-site emitting an event NOT registered in this phase (e.g. `ORDER_FILLED`) stays legacy — leave it.

### Procedure VERIFY — per-slice gate (must be green to commit)
```bash
cd <worktree-root>
# 1. registry name-source sync + parse backstop
pnpm nx test test-contracts --skip-nx-cache
# 2. type-check each touched producer + test project (no emit)
npx tsc --noEmit -p services/advisory/<svc>/tsconfig.json   # repeat per touched svc
# 3. repo-wide typed-fixtures gate (registry-driven)
node tools/check-typed-fixtures.mjs
# 4. lint touched projects (cache OFF — masks the test-only cycle)
pnpm nx lint <proj> --skip-nx-cache                          # repeat per touched proj
```
Step 3 must report `OK`; any violation lists a `file:line` of a still-legacy registered-event call-site — fix it (Procedure MIG) and re-run.

---

## Event → schema → home reference (the full Phase 2 surface)

Schemas marked **EXISTS** are already defined; **NEW** must be authored in the task (zod body given inline).
All advisory events home their map in the producer's own `<svc>/contracts.ts` (every event below is consumed intra-advisory or via CDC; none needs the `advisory-adpt/domain` re-export — the `-adpt/domain` route is only for the production cross-domain *consumer* import path, which the gate-ignored test-contracts cycle makes unnecessary here).

| Event | Producer (home file) | Schema | Fixtures emit it (from inventory) |
|---|---|---|---|
| DECISION_PACKET_CREATED / _UPDATED | decision-workflow-ctrl | DecisionPacketSchema **EXISTS** | advisory-bff integration (19), e2e `emitDecisionSnapshot` helper, DWC tests |
| MANDATE_SNAPSHOT_CREATED | decision-workflow-ctrl | MandateSnapshotSchema **EXISTS** | DWC tests (if emitted) |
| DECISION_CYCLE_STARTED / _FAILED | decision-workflow-ctrl | DecisionCycleStarted/FailedSchema **EXISTS** | DWC tests (if emitted) |
| CONSTRUCT_PORTFOLIO | decision-workflow-ctrl | ConstructPortfolioSchema **NEW** | portfolio-engine-ctrl tests (6) |
| GENERATE_NARRATIVE | decision-workflow-ctrl | GenerateNarrativeSchema **NEW** | advisory-narrative-ctrl tests (6) |
| DECISION_APPROVED / DECISION_BLOCKED | compliance-ctrl | ComplianceCheckSchema **EXISTS** | investor-profile-ctrl resilience (2), DWC tests |
| PORTFOLIO_COMPLETED / PORTFOLIO_FAILED | portfolio-engine-ctrl | PortfolioAgentCompletion/FailureSchema **EXISTS** | DWC tests |
| NARRATIVE_COMPLETED / NARRATIVE_FAILED | advisory-narrative-ctrl | NarrativeAgentCompletion/FailureSchema **EXISTS** | DWC tests |
| EXPLANATION_GENERATED | advisory-narrative-ctrl | ExplanationGeneratedSchema **EXISTS** | DWC / advisory-bff tests |
| INVESTOR_PROFILE_SNAPSHOT_CREATED / _UPDATED | investor-profile-ctrl | InvestorProfileSnapshotSchema **EXISTS** | DWC snapshot-projector tests |
| MARKET_SNAPSHOT_UPDATED | market-intelligence-ctrl | MarketSnapshotSchema **EXISTS** | DWC snapshot-projector tests |
| MARKET_SNAPSHOT_REFRESH_TICK | market-intelligence-ctrl | MarketSnapshotRefreshTickSchema **NEW** | MI-ctrl tests |
| DECISION_READ_MODEL_CREATED / _UPDATED | advisory-bff | DecisionReadModelSchema **EXISTS** | (gate-coverage; migrate any found repo-wide) |
| USER_CONFIRMED / USER_REJECTED | advisory-bff | UserConfirmation/UserRejectionSchema **EXISTS** | (gate-coverage; migrate any found repo-wide) |
| ADVISORY_STATUS_UPDATED | advisory-bff | AdvisoryStatusSchema **EXISTS** | (gate-coverage; migrate any found repo-wide) |
| YAHOO_FINANCE_UPDATED | yahoo-finance-adpt | YahooFinance event-row schema **EXISTS/confirm** | MI-ctrl tests (part of the 11) |
| SEC_PROSPECTUS_UPDATED | sec-edgar-adpt | SecFilingSchema **EXISTS/confirm** | portfolio-engine-ctrl tests (2) |
| ALPHA_VANTAGE_NEWS_UPDATED / _ECONOMIC_INDICATOR_UPDATED | alpha-vantage-adpt | AlphaVantage schemas **EXISTS/confirm** | adapter tests / MI-ctrl |
| FRED_INDICATORS_UPDATED | fred-adpt | FredIndicatorSchema **EXISTS/confirm** | adapter tests / MI-ctrl |
| MARKETWATCH_UPDATED | marketwatch-adpt | MarketWatchArticle event-row schema **EXISTS/confirm** | adapter tests / MI-ctrl |
| FETCH_YAHOO_FINANCE_REQUESTED / FETCH_SEC_EDGAR_REQUESTED / FETCH_ALPHA_VANTAGE_REQUESTED / FETCH_FRED_REQUESTED / FETCH_MARKETWATCH_REQUESTED | each adapter | `FetchRequestedSchema = z.object({})` **NEW** (one per adapter, empty subject) | each adapter's own integration tests (13 total) |

> **Confirm** = the agent saw a per-article/per-item schema (e.g. `YahooFinanceArticleSchema`); the *event subject* is the CDC row (e.g. `{ ticker, source, articles }`). In the adapter task, reference the schema matching the **emitted event subject**; if only a per-item schema exists, author the small wrapper schema describing the emitted row.

> **NOT registered in Phase 2** (no fixture emits them and no schema exists — authoring would be speculative): `DECISION_FEEDBACK`, `USER_VIEWED_EXPLANATION`, `USER_INTERACTION_CREATED/_UPDATED`, the `*_AGENT_INVOCATION_TRACED` trace events, `GUARDRAIL_VIOLATION_DETECTED`, `COMPLIANCE_APPROVAL_GRANTED`, `SUITABILITY_CHECK_*`, `AUDIT_ARTIFACT_*`, `GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`. If a later task's gate run reveals a fixture DOES emit one of these, stop and add it via Procedure REG (authoring the schema from the real producer) before proceeding.

---

## Task 1: DWC DecisionPacket family — register + migrate (establishes the rhythm)

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts` (extend `decisionWorkflowEventSubjects`)
- Modify: `libs/test-contracts/src/index.ts` (map already imported — only the map body grows)
- Modify: `tools/typed-fixture-registered-events.json`, `libs/test-contracts/test/registry.test.ts`
- Test/migrate: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` (19 sites), `apps/e2e-feature-tests/src/helpers/fixtures.ts` (`emitDecisionSnapshot`, ~line 256), any DWC test emitting these.

**Interfaces:**
- Produces: registry now contains `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `MANDATE_SNAPSHOT_CREATED`, `DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED` (in addition to the existing `RECOMMENDATION_PROPOSED`). `SubjectOf<'DECISION_PACKET_CREATED'>` = `z.infer<typeof DecisionPacketSchema>`.

- [ ] **Step 1: Extend the DWC map.** In `decision-workflow-ctrl/src/domain/contracts.ts`, change `decisionWorkflowEventSubjects` to:

```ts
export const decisionWorkflowEventSubjects = {
  RECOMMENDATION_PROPOSED: RecommendationProposedSchema,
  DECISION_PACKET_CREATED: DecisionPacketSchema,
  DECISION_PACKET_UPDATED: DecisionPacketSchema,
  MANDATE_SNAPSHOT_CREATED: MandateSnapshotSchema,
  DECISION_CYCLE_STARTED: DecisionCycleStartedSchema,
  DECISION_CYCLE_FAILED: DecisionCycleFailedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Sync the registry name-sources.** Add `DECISION_CYCLE_FAILED`, `DECISION_CYCLE_STARTED`, `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `MANDATE_SNAPSHOT_CREATED` (sorted) to `tools/typed-fixture-registered-events.json` AND `libs/test-contracts/test/registry.test.ts` `EXPECTED`.
- [ ] **Step 3: Run the sync test — expect PASS.** `pnpm nx test test-contracts --skip-nx-cache`. (No fixtures migrated yet, but the gate is repo-wide and run separately.)
- [ ] **Step 4: Run the gate — expect FAIL** listing the legacy `DECISION_PACKET_*` call-sites. `node tools/check-typed-fixtures.mjs`. This is your migration worklist.
- [ ] **Step 5: Migrate each listed call-site** via Procedure MIG. For `advisory-bff.integration.test.ts`: `DecisionPacketSchema` is DRY — strip `tenantId`/`userId` from the `detail`, pass them in `context`. The `emitDecisionSnapshot` helper in `apps/e2e-feature-tests/src/helpers/fixtures.ts` is high-leverage (one change covers many e2e scenarios via `withDecision`).
- [ ] **Step 6: Run Procedure VERIFY.** tsc for `decision-workflow-ctrl` + `advisory-bff`; `check-typed-fixtures.mjs` → `OK`; `test test-contracts`; lint `advisory-bff` + `e2e-feature-tests` `--skip-nx-cache`.
- [ ] **Step 7: Commit.**

```bash
git add -A && git commit --no-verify -m "refactor(advisory): type DecisionPacket-family fixtures (typed-test-fixtures Phase 2)

Register DECISION_PACKET_*/MANDATE_SNAPSHOT_CREATED/DECISION_CYCLE_* in EventSubjects;
migrate advisory-bff + e2e DecisionPacket fixtures to typed putEvent. (a)=N (b)=M.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 2: Compliance results (DECISION_APPROVED / DECISION_BLOCKED)

**Files:** Modify `services/advisory/compliance-ctrl/src/domain/contracts.ts` (new `complianceCtrlEventSubjects`), `libs/test-contracts/src/index.ts`, the two registry name-sources. Migrate: `services/advisory/investor-profile-ctrl/test/**` (resilience, 2 sites at ~176, 207), any DWC test emitting compliance results.

**Interfaces:** Produces `DECISION_APPROVED`, `DECISION_BLOCKED` → `ComplianceCheckSchema`.

- [ ] **Step 1: Add the map.** In `compliance-ctrl/src/domain/contracts.ts` append:

```ts
import type { ZodTypeAny } from 'zod';

export const complianceCtrlEventSubjects = {
  DECISION_APPROVED: ComplianceCheckSchema,
  DECISION_BLOCKED: ComplianceCheckSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Register** via Procedure REG steps 3–4 (import `complianceCtrlEventSubjects` from `@nestfolio/compliance-ctrl/contracts`; add `DECISION_APPROVED`, `DECISION_BLOCKED` to both name-sources).
- [ ] **Step 3: Migrate** the flagged call-sites (Procedure MIG). `ComplianceCheckSchema` is rich (mandateSnapshot/violations/authorityLevel) — the compiler will surface any fixture that sent a thin `detail`.
- [ ] **Step 4: Procedure VERIFY** (tsc compliance-ctrl + investor-profile-ctrl; gate `OK`; test-contracts; lint touched `--skip-nx-cache`).
- [ ] **Step 5: Commit** `refactor(advisory): type compliance-result fixtures (typed-test-fixtures Phase 2)`.

## Task 3: Advisory agent completions (portfolio-engine-ctrl + advisory-narrative-ctrl)

**Files:** Modify `portfolio-engine-ctrl/src/domain/contracts.ts` (new `portfolioEngineCtrlEventSubjects`), `advisory-narrative-ctrl/src/domain/contracts.ts` (new `advisoryNarrativeCtrlEventSubjects`), `libs/test-contracts/src/index.ts`, both name-sources. Migrate: DWC tests emitting `PORTFOLIO_COMPLETED/FAILED`, `NARRATIVE_COMPLETED/FAILED`, `EXPLANATION_GENERATED` (DWC consumes agent completions via the SF callback path).

**Interfaces:** Produces `PORTFOLIO_COMPLETED`, `PORTFOLIO_FAILED`, `NARRATIVE_COMPLETED`, `NARRATIVE_FAILED`, `EXPLANATION_GENERATED`.

- [ ] **Step 1: Add the maps.**

```ts
// portfolio-engine-ctrl/src/domain/contracts.ts
import type { ZodTypeAny } from 'zod';
export const portfolioEngineCtrlEventSubjects = {
  PORTFOLIO_COMPLETED: PortfolioAgentCompletionSchema,
  PORTFOLIO_FAILED: PortfolioAgentFailureSchema,
} as const satisfies Record<string, ZodTypeAny>;
```
```ts
// advisory-narrative-ctrl/src/domain/contracts.ts
import type { ZodTypeAny } from 'zod';
export const advisoryNarrativeCtrlEventSubjects = {
  NARRATIVE_COMPLETED: NarrativeAgentCompletionSchema,
  NARRATIVE_FAILED: NarrativeAgentFailureSchema,
  EXPLANATION_GENERATED: ExplanationGeneratedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Register** both maps (Procedure REG 3–4).
- [ ] **Step 3: Migrate** flagged call-sites (Procedure MIG).
- [ ] **Step 4: Procedure VERIFY** (tsc portfolio-engine-ctrl + advisory-narrative-ctrl + decision-workflow-ctrl; gate `OK`; test-contracts; lint touched).
- [ ] **Step 5: Commit** `refactor(advisory): type agent-completion fixtures (typed-test-fixtures Phase 2)`.

## Task 4: Snapshots (investor-profile-ctrl + market-intelligence-ctrl MARKET_SNAPSHOT_UPDATED)

**Files:** Modify `investor-profile-ctrl/src/domain/contracts.ts` (new `investorProfileCtrlEventSubjects`), `market-intelligence-ctrl/src/domain/contracts.ts` (new `marketIntelligenceCtrlEventSubjects`), `libs/test-contracts/src/index.ts`, both name-sources. Migrate: DWC `snapshot-projector` tests emitting `INVESTOR_PROFILE_SNAPSHOT_*` / `MARKET_SNAPSHOT_UPDATED`.

**Interfaces:** Produces `INVESTOR_PROFILE_SNAPSHOT_CREATED`, `INVESTOR_PROFILE_SNAPSHOT_UPDATED`, `MARKET_SNAPSHOT_UPDATED`.

- [ ] **Step 1: Add the maps.**

```ts
// investor-profile-ctrl/src/domain/contracts.ts
import type { ZodTypeAny } from 'zod';
export const investorProfileCtrlEventSubjects = {
  INVESTOR_PROFILE_SNAPSHOT_CREATED: InvestorProfileSnapshotSchema,
  INVESTOR_PROFILE_SNAPSHOT_UPDATED: InvestorProfileSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;
```
```ts
// market-intelligence-ctrl/src/domain/contracts.ts
import type { ZodTypeAny } from 'zod';
export const marketIntelligenceCtrlEventSubjects = {
  MARKET_SNAPSHOT_UPDATED: MarketSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;   // MARKET_SNAPSHOT_REFRESH_TICK added in Task 5
```

- [ ] **Step 2: Register** (Procedure REG 3–4).
- [ ] **Step 3: Migrate** flagged call-sites. The `snapshot-projector` tests use `putEvent` to inject the CDC-shaped event — the typed envelope `putEvent` builds is the same `BusEvent`, so migration is safe as long as the `subject` matches the schema.
- [ ] **Step 4: Procedure VERIFY** (tsc investor-profile-ctrl + market-intelligence-ctrl + decision-workflow-ctrl; gate `OK`; test-contracts; lint touched).
- [ ] **Step 5: Commit** `refactor(advisory): type snapshot fixtures (typed-test-fixtures Phase 2)`.

## Task 5: NEW command schemas — CONSTRUCT_PORTFOLIO + GENERATE_NARRATIVE

**Files:** Modify `decision-workflow-ctrl/src/domain/contracts.ts` (author 2 schemas + extend the map), `libs/test-contracts/src/index.ts` (no new import — map grows), both name-sources. Migrate: `portfolio-engine-ctrl` tests (`CONSTRUCT_PORTFOLIO` ×6), `advisory-narrative-ctrl` tests (`GENERATE_NARRATIVE` ×6).

**Interfaces:** Produces `CONSTRUCT_PORTFOLIO`, `GENERATE_NARRATIVE`.

- [ ] **Step 1: Confirm the real emission.** Read `decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (~lines 121–146) and the consumers `portfolio-engine-ctrl/src/handlers/event-listener.ts` + `advisory-narrative-ctrl/src/handlers/event-listener.ts`. Confirm the consumed subject fields and whether identity is read from subject or context.
- [ ] **Step 2: Author the schemas** (DRY — identity excluded; upstream agent outputs are opaque records). Append to `decision-workflow-ctrl/src/domain/contracts.ts`:

```ts
/** CONSTRUCT_PORTFOLIO — SF command (decision-state-machine.ts) to portfolio-engine-ctrl.
 *  DRY subject — tenantId travels in context. Upstream agent outputs are opaque. */
export const ConstructPortfolioSchema = z.object({
  decisionId: z.string(),
  taskToken: z.string(),
  operatingMode: z.string(),
  investorProfile: z.record(z.string(), z.unknown()),
  marketAnalysis: z.record(z.string(), z.unknown()),
});
export type ConstructPortfolio = z.infer<typeof ConstructPortfolioSchema>;

/** GENERATE_NARRATIVE — SF command to advisory-narrative-ctrl. Adds the portfolio output. */
export const GenerateNarrativeSchema = ConstructPortfolioSchema.extend({
  portfolio: z.record(z.string(), z.unknown()),
});
export type GenerateNarrative = z.infer<typeof GenerateNarrativeSchema>;
```

- [ ] **Step 3: Triage the SF emission.** The SF emits `tenantId` inside the subject (jsonPath `$.tenantId`) and the consumers read identity from context — i.e. `tenantId`-in-subject is a non-DRY producer emission. This is a **(b) latent finding**: file it via `backlog-add` ("DWC SF emits CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE with tenantId in the subject — non-DRY; harmless, consumer reads context") and proceed with the DRY schema. Do NOT change the SF.
- [ ] **Step 4: Extend the map** in the same file:

```ts
export const decisionWorkflowEventSubjects = {
  RECOMMENDATION_PROPOSED: RecommendationProposedSchema,
  DECISION_PACKET_CREATED: DecisionPacketSchema,
  DECISION_PACKET_UPDATED: DecisionPacketSchema,
  MANDATE_SNAPSHOT_CREATED: MandateSnapshotSchema,
  DECISION_CYCLE_STARTED: DecisionCycleStartedSchema,
  DECISION_CYCLE_FAILED: DecisionCycleFailedSchema,
  CONSTRUCT_PORTFOLIO: ConstructPortfolioSchema,
  GENERATE_NARRATIVE: GenerateNarrativeSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 5: Sync name-sources** (`CONSTRUCT_PORTFOLIO`, `GENERATE_NARRATIVE`).
- [ ] **Step 6: Migrate** the flagged fixtures. Current fixtures send a thin `{ tenantId, decisionId, taskToken, operatingMode, context: {} }` — remove `tenantId` + the stray nested `context: {}`, add `investorProfile: {}`, `marketAnalysis: {}` (and `portfolio: {}` for GENERATE_NARRATIVE) to satisfy the schema (empty records are valid), and pass `context: { tenantId: ctx.tenantId }`. These are **(a)** fixes.
- [ ] **Step 7: Procedure VERIFY** (tsc decision-workflow-ctrl + portfolio-engine-ctrl + advisory-narrative-ctrl; gate `OK`; test-contracts; lint touched).
- [ ] **Step 8: Commit** `refactor(advisory): type SF command fixtures CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE (typed-test-fixtures Phase 2)`.

## Task 6: NEW MARKET_SNAPSHOT_REFRESH_TICK schema

**Files:** Modify `market-intelligence-ctrl/src/domain/contracts.ts` (author schema + extend the map from Task 4), name-sources. Migrate: `market-intelligence-ctrl` tests emitting the tick (part of the 11).

- [ ] **Step 1: Confirm shape.** Read `market-intelligence-ctrl/src/handlers/scheduled-emitter.ts` (~lines 30–63); the emitted subject is `{ region }`.
- [ ] **Step 2: Author + extend.**

```ts
/** MARKET_SNAPSHOT_REFRESH_TICK — self-tick from scheduled-emitter.ts; drives the slow-tier rebuild. */
export const MarketSnapshotRefreshTickSchema = z.object({ region: z.string() });
export type MarketSnapshotRefreshTick = z.infer<typeof MarketSnapshotRefreshTickSchema>;

export const marketIntelligenceCtrlEventSubjects = {
  MARKET_SNAPSHOT_UPDATED: MarketSnapshotSchema,
  MARKET_SNAPSHOT_REFRESH_TICK: MarketSnapshotRefreshTickSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 3: Sync name-sources** (`MARKET_SNAPSHOT_REFRESH_TICK`).
- [ ] **Step 4: Migrate** the tick fixtures (Procedure MIG). `YAHOO_FINANCE_UPDATED` call-sites in the same file stay legacy until Task 7.
- [ ] **Step 5: Procedure VERIFY** (tsc market-intelligence-ctrl; gate `OK`; test-contracts; lint market-intelligence-ctrl).
- [ ] **Step 6: Commit** `refactor(market-intelligence-ctrl): type MARKET_SNAPSHOT_REFRESH_TICK fixtures (typed-test-fixtures Phase 2)`.

## Task 7: Market-data adapters (outputs + FETCH commands)

**Files:** For each of `yahoo-finance-adpt`, `sec-edgar-adpt`, `alpha-vantage-adpt`, `fred-adpt`, `marketwatch-adpt`: modify `src/domain/contracts.ts` (new `<adpt>EventSubjects`, + any wrapper schema for the emitted event row, + `FetchRequestedSchema`). Modify `libs/test-contracts/src/index.ts` (5 imports + spreads), both name-sources. Migrate: each adapter's own integration tests (FETCH commands, 13 total), MI-ctrl `YAHOO_FINANCE_UPDATED` (rest of the 11), portfolio-engine-ctrl `SEC_PROSPECTUS_UPDATED` (2).

**Interfaces:** Produces the adapter output event names + the 5 `FETCH_*_REQUESTED` names.

- [ ] **Step 1: Per adapter, locate the emitted event-subject schema.** Read each `<adpt>/src/handlers/event-listener.ts` `project(...)` call and `src/domain/events.ts` for the exact emitted detailType + the row schema. Reference the schema describing the **emitted event subject** (e.g. `{ ticker, source, articles }`); if only a per-item schema exists (`YahooFinanceArticleSchema`), author a wrapper, e.g.:

```ts
export const YahooFinanceUpdatedSchema = z.object({
  ticker: z.string(),
  source: z.literal('yahoo-finance'),
  articles: z.array(z.unknown()),
});
```

- [ ] **Step 2: Per adapter, add the map** (one empty `FetchRequestedSchema` per adapter):

```ts
import type { ZodTypeAny } from 'zod';
/** Inbound fetch trigger — empty subject (fetch-trigger.ts emits subject:{}). */
export const FetchRequestedSchema = z.object({});
export const <adpt>EventSubjects = {
  <OUTPUT_EVENT_NAME>: <OutputSchema>,
  <FETCH_EVENT_NAME>: FetchRequestedSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

  Use the exact detailType constants from each adapter's `events.ts` (confirm: `FETCH_*_REQUESTED`, `YAHOO_FINANCE_UPDATED`, `SEC_PROSPECTUS_UPDATED`, `ALPHA_VANTAGE_NEWS_UPDATED` + `ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED`, `FRED_INDICATORS_UPDATED`, `MARKETWATCH_UPDATED`).
- [ ] **Step 3: Register** all 5 maps (Procedure REG 3–4) — 5 imports + spreads in `index.ts`; add every new event name (sorted) to both name-sources.
- [ ] **Step 4: Migrate** the flagged fixtures (adapter FETCH tests; MI-ctrl YAHOO; portfolio-engine-ctrl SEC). FETCH fixtures: `subject: {}`, `context: { tenantId: 'SYSTEM' }` (matches the real `fetch-trigger.ts`).
- [ ] **Step 5: Procedure VERIFY** (tsc each of the 5 adapters + market-intelligence-ctrl + portfolio-engine-ctrl; gate `OK`; test-contracts; lint each touched project `--skip-nx-cache`).
- [ ] **Step 6: Commit** `refactor(advisory-adapters): type market-data adapter + fetch-command fixtures (typed-test-fixtures Phase 2)`.

## Task 8: advisory-bff own events (registry completeness)

**Files:** Modify `advisory-bff/src/domain/contracts.ts` (new `advisoryBffEventSubjects`), `libs/test-contracts/src/index.ts`, both name-sources. Migrate: any repo-wide fixture the gate flags for these events (may be zero in this phase — they are advisory-bff *outputs*, consumed downstream; the gate confirms).

**Interfaces:** Produces `DECISION_READ_MODEL_CREATED/_UPDATED`, `USER_CONFIRMED`, `USER_REJECTED`, `ADVISORY_STATUS_UPDATED`.

- [ ] **Step 1: Add the map.**

```ts
// advisory-bff/src/domain/contracts.ts
import type { ZodTypeAny } from 'zod';
export const advisoryBffEventSubjects = {
  DECISION_READ_MODEL_CREATED: DecisionReadModelSchema,
  DECISION_READ_MODEL_UPDATED: DecisionReadModelSchema,
  USER_CONFIRMED: UserConfirmationSchema,
  USER_REJECTED: UserRejectionSchema,
  ADVISORY_STATUS_UPDATED: AdvisoryStatusSchema,
} as const satisfies Record<string, ZodTypeAny>;
```

- [ ] **Step 2: Register** (Procedure REG 3–4).
- [ ] **Step 3: Run the gate** (`node tools/check-typed-fixtures.mjs`). Migrate every flagged call-site repo-wide (Procedure MIG) — including any in `services/execution`/`services/ledger` that emit these advisory events. If the gate reports `OK` with no new flags, there are no fixtures to migrate (registration alone adds future coverage).
- [ ] **Step 4: Procedure VERIFY** (tsc advisory-bff + any other touched project; gate `OK`; test-contracts; lint touched).
- [ ] **Step 5: Commit** `refactor(advisory-bff): register advisory-bff output events in typed-fixture registry (typed-test-fixtures Phase 2)`.

## Task 9: Final verification, (a)/(b) log, ship

**Files:** `docs/backlog/typed-test-fixtures-phase2-advisory.md` (status/validation_gate).

- [ ] **Step 1: Full static gate.**

```bash
node tools/check-typed-fixtures.mjs                 # expect OK
pnpm nx test test-contracts --skip-nx-cache         # registry sync + parse backstop
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" --skip-nx-cache || echo "none"
```

- [ ] **Step 2: tsc sweep** of every touched advisory service (`npx tsc --noEmit -p services/advisory/<svc>/tsconfig.json`) — confirm no new type errors introduced by the migration. (Pre-existing latent tsc errors are tracked separately in `investor-services-latent-tsc-errors`/`broker-alpaca-adpt-latent-tsc-errors` — do not fix here; only confirm the migration added none.)
- [ ] **Step 3: Compile the (a)/(b) log.** Sum the per-task tallies; confirm every (b) has a filed backlog id. Put the totals in the ship commit body and the backlog `validation_gate`.
- [ ] **Step 4: Confirm no remaining advisory legacy registered-event call-sites.** `node tools/check-typed-fixtures.mjs` final `OK`; note any intentionally-legacy call-sites (events whose producer is Execution/Ledger/Investor — deferred to their phase) in the ship note.
- [ ] **Step 5: Ship** — set `docs/backlog/typed-test-fixtures-phase2-advisory.md` `status: shipped`, fill `validation_gate:` (gate `OK` line, `test-contracts` pass, tsc-clean list, (a)/(b) totals, the decoupled-runtime note pointing at `typed-test-fixtures-consolidated-integration-e2e-verify`). Run `node .claude/skills/backlog-lint/lint.mjs --fix`, commit. Then the `/backlog-next` closing phase (finishing-a-development-branch) handles merge.

---

## Self-review

- **Spec coverage:** §3.1 producer maps → Tasks 1–8; §3.2 registry composition → every task's REG; §3.3 typed putEvent migration → every task's MIG; §6 regression gate → the repo-wide `check-typed-fixtures.mjs` already covers advisory once its events are registered (no new gate code needed — registration IS the extension); §7 (a)/(b) triage → MIG + Task 9 log. ✓
- **Phasing:** every advisory producer (8 core + 5 adapters) gets a map; advisory-hub excluded (no handlers). ✓
- **Type consistency:** map const names (`<svc>EventSubjects`), schema names (verified to exist), and event names are used identically across REG/the reference table/tasks. ✓
- **No deploy / decoupled runtime:** validation is static (gate + tsc + unit + lint); the deployed-dev integration/e2e run is owned by `typed-test-fixtures-consolidated-integration-e2e-verify`. ✓
- **Open risk:** the cross-domain migration surface (advisory events emitted in Execution/Ledger/Investor tests) is discovered by the repo-wide gate at each task's VERIFY, not pre-inventoried — accepted, because the gate cannot be green while any registered-event call-site remains legacy.
