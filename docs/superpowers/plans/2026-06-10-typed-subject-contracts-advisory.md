# Typed-Subject Contracts — Advisory (slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Advisory-domain producer aggregate has a producer-owned zod subject contract (`<Name>Schema` + `type <Name>`, NO `Subject` suffix) that types both the persisted row (`TableEntry<Subject, S>`) and the emitted event (`BusEvent<Subject, S>`), validated against the **REAL** deployed emission — the fourth and richest slice of the `typed-subject-producer-contracts` umbrella. This slice also converts the advisory-produced `ProposedTrade` plain interface to zod (the piece the Execution slice deferred), exercises `RegionContext` (MarketSnapshot) and the bare-base global (`SecFiling`/feed adapters), and fixes the stale `compliance-ctrl` `DecisionApprovedSchema`.

**Architecture:** Dry-aggregate zod schemas live in each producer's `domain/contracts.ts` (imports ONLY zod, or reuses the service's own `agents/schemas.ts`). Identity (`tenantId`/`userId`/`region`) is DRY — it travels in the event **context** (`RequestContext`, or `RegionContext` for market data, or the bare `SubjectContext` for global feed data), never on the subject (zod strips it). Inline/hand-rolled **row** types that re-declare `pk`/`sk`/`__typename` are replaced with `TableEntry<Subject, S>` (intersected with a literal `__typename` + any row-only operational fields, per the ledger `TaxLotEntry` precedent). The shared `AgentCompletionRow<A>`/`AgentFailureRow<A>` generic + its PK/SK helpers move to `libs/agent-orchestrator` (locked decision below). A scoped e2e drives a REAL advisory decision cycle (DWC SF + agents + compliance) AND real feed fetches, parsing each persisted row against its contract — the stale compliance schema is standing proof fixtures hide drift ([[event-subject-contracts]]).

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`TableEntry<T,S>`, `BusEvent<T,S>`, `record()`, `update()`, `projectVersioned()`, `parseSubject`, `RequestContext`, `RegionContext`, `SubjectContext`), `@nestfolio/agent-orchestrator`, Nx, Jest, `@nestfolio/test-support` (e2e), AWS DynamoDB DocumentClient, real Bedrock AgentCore agents.

---

## Design decisions (locked by user, 2026-06-10)

1. **AgentCompletionRow home = `libs/agent-orchestrator`.** The shared `AgentCompletionRow<A extends string>` / `AgentFailureRow<A extends string>` generic + the verbatim-duplicated `AgentCompletion#`/`AgentFailure#` PK/SK helpers move into `libs/agent-orchestrator` (alongside `AgentConfig`, the SF-callback primitives, `wrapAgentOutput`, `assertOrchestratorOutput`). Both `portfolio-engine-ctrl` and `advisory-narrative-ctrl` already import that lib; this dedups the two identical `agent-completion.repository.ts` helper copies and gives a future task-token agent service the row type for free. The zod `agentOutput` payload schema stays per-service in `<svc>/contracts`.
2. **`agentOutput` typing = per-service derived wrapper schema.** `agentOutput` is the COMPOSITE `runPipeline` return, not a bare agent schema (PE: `{decisionId, allocations: PortfolioConstruction, trades: RebalancePlan, metadata}`; AN: `{decisionId, ...explainability, metadata}`). Author a `PortfolioAgentOutputSchema` / `NarrativeAgentOutputSchema` in each service's `contracts.ts` that COMPOSES the existing `agents/schemas.ts` schemas + `decisionId` + `metadata`. This validates against the REAL emission (the #1-risk gate) and is what DWC's `AssemblePacket`/`sfn-callback` consume.

## Conventions applied (umbrella design § "The conventions")

- **(1) parseSubject-only reads** — out of scope here (WS-3); this slice only AUTHORS contracts + converts producer rows. **One narrow exception:** the MarketSnapshot `region` field-move (Task 4) FORCES a one-line DWC consumer co-change (`subject.region` → `ctx.region`) — without it the producer change breaks DWC at runtime. That co-change mirrors how DWC's IP/Ledger projectors already read identity from `ctx`, and is the minimum required-by-producer co-change, NOT a general consumer retype.
- **(3) One subject type for row + event** — the row is `TableEntry<Subject, S>`, the event is `BusEvent<Subject, S>`; no hand-rolled row interfaces re-declaring `pk/sk/__typename`.
- **(4) Clean event-aligned names** — `<Name>Schema` + `type <Name>`, no `Subject` suffix. The compliance row fans into two events from one row → one `ComplianceCheck` schema (the `NormalizedOrderEvent` precedent).
- **(5)+(6) Context generic `S`, pure aggregates** — subjects model business fields only; identity travels in `S` (`RequestContext` / `RegionContext` / bare `SubjectContext`). Row literals are `satisfies TableEntry<Subject, S>` where a TS write-site exists; SF-ASL-emitted subjects (DWC) are contract-only (no TS write-site to annotate — validated by unit + e2e, the broker-ctrl `NormalizedOrderEvent` precedent).

---

## Background facts (verified against code 2026-06-10 — do NOT re-derive)

**Phase-0 (shipped 2026-06-09):** `SubjectContext = object` / `RegionContext extends SubjectContext { region: string }` / re-based `RequestContext { tenantId, userId, region }` in `libs/event-processor/src/domain/schemas.ts`; `BusEvent<T, S extends SubjectContext = RequestContext>` (`platform/bus.ts`); `TableEntry<T extends object, S extends SubjectContext = RequestContext>` (`platform/table.ts`). All exported from `@nestfolio/event-processor`. `parseSubject(carrier, schema)` at `libs/event-processor/src/util/parse-subject.ts`.

**Subpath wiring is tsconfig-only.** `@nestfolio/<svc>/contracts` and `/domain` subpaths are wired SOLELY via `tsconfig.base.json` `compilerOptions.paths` — there are NO per-service `package.json` `exports`. Adding a subpath = one line in `tsconfig.base.json`. `investor-profile-ctrl/contracts` (line ~84) + `market-intelligence-ctrl/contracts` (line ~90) ALREADY exist; `advisory-adpt/domain` (line ~101) exists.

**CDC context carries identity from the row** (`libs/event-processor/src/pipelines/change-data-capture.ts:130-133`): the emitted event's `context = { tenantId: record.tenantId, userId: record.userId, region: record.region }` — read straight from the persisted row's fields. ⇒ a region-scoped row that physically stores `region` emits `context.region` even with `region` dropped from its subject schema (Task 4 relies on this).

**The contract pattern (ledger/investor/execution precedent):** `src/domain/contracts.ts` imports ONLY zod (or reuses the service's `agents/schemas.ts`); each contract is `export const <Name>Schema = z.object({…})` immediately followed by `export type <Name> = z.infer<typeof <Name>Schema>;`. Subjects are DRY (no identity). Tested in `test/unit/domain/contracts.test.ts` (or flat `test/unit/contracts.test.ts` where the service uses a flat layout) with: (a) a real subject parses; (b) DRY — `expect('tenantId' in parsed).toBe(false)`; (c) required domain fields throw when absent / bad enum rejects. Rows are typed via a plain typed binding or `satisfies TableEntry<Subject, S> & { __typename: '<T>' }`. **Skip any `satisfies` that won't compile cleanly — revert to a plain literal (non-load-bearing; the e2e gate is the proof).** Worktree commits use `--no-verify` ([[feedback-worktree-commit-no-verify]]); verify each landed.

### Census — Advisory producer subjects (the work surface)

| Producer | Subject (dry) | Row __typename / sk | Emitted as | Context `S` | Home | Status |
|---|---|---|---|---|---|---|
| advisory-adpt | `ProposedTrade` (value object) | — (nests in Order/StagedOrder) | — | n/a (nested) | advisory-adpt/contracts → re-export via /domain | **NEW** (interface→zod) |
| compliance-ctrl | `ComplianceCheck` | `ComplianceCheck` / `ComplianceCheck` | DECISION_APPROVED (result=APPROVED) / DECISION_BLOCKED (result=BLOCKED) | `RequestContext` | compliance-ctrl/contracts | **NEW** (replaces dead `DecisionApprovedSchema`/`DecisionBlockedSchema`) |
| investor-profile-ctrl | `InvestorProfileSnapshot` (exists) | `InvestorProfileSnapshot` / `InvestorProfileSnapshot` | INVESTOR_PROFILE_SNAPSHOT_CREATED/UPDATED | `RequestContext` | investor-profile-ctrl/contracts | EXISTS (keep) — **row → TableEntry** |
| market-intelligence-ctrl | `MarketSnapshot` (exists, carries region) | `MarketSnapshot` / `MarketSnapshot` | MARKET_SNAPSHOT_UPDATED | `RegionContext` | market-intelligence-ctrl/contracts | **MODIFY** (drop region → S) + **row → TableEntry** |
| portfolio-engine-ctrl | `PortfolioAgentOutput` + `AgentCompletion<'portfolio-engine'>`/`AgentFailure` | `AgentCompletion`/`AgentFailure` / `AgentCompletion#${agentName}` | PORTFOLIO_COMPLETED / PORTFOLIO_FAILED | `RequestContext`* | portfolio-engine-ctrl/contracts + agent-orchestrator (generic) | **NEW** |
| advisory-narrative-ctrl | `NarrativeAgentOutput` + `AgentCompletion<'advisory-narrative'>`/`AgentFailure` | `AgentCompletion`/`AgentFailure` | NARRATIVE_COMPLETED / NARRATIVE_FAILED | `RequestContext`* | advisory-narrative-ctrl/contracts + agent-orchestrator (generic) | **NEW** |
| decision-workflow-ctrl | `DecisionPacket`, `MandateSnapshot`, `RecommendationProposed`, `DecisionCycleStarted`, `DecisionCycleFailed` | `DecisionPacket`/`MandateSnapshot` (CDC) + 3 SF-direct | DECISION_PACKET_CREATED/UPDATED, MANDATE_SNAPSHOT_CREATED (CDC); RECOMMENDATION_PROPOSED, DECISION_CYCLE_STARTED/FAILED (SF-direct) | `RequestContext` | decision-workflow-ctrl/contracts | **NEW** |
| decision-workflow-ctrl | `IpSnapshotMirror`, `MarketSnapshotMirror` (local projection rows) | `InvestorProfileSnapshot`/`MarketSnapshot` / projected sk | — (DWC-local mirror, not emitted) | `RequestContext` / `RegionContext` | decision-workflow-ctrl/contracts | **NEW** (row → TableEntry; agentOutput stored as JSON string) |
| advisory-bff | `DecisionReadModel`, `UserConfirmation`, `UserRejection` | resp. `Decision…`/`UserConfirmation#…`/`UserRejection#…` | DECISION_READ_MODEL_CREATED/UPDATED, USER_CONFIRMED, USER_REJECTED | `RequestContext` | advisory-bff/contracts | **NEW** |
| sec-edgar-adpt | `SecFiling` | `SecFiling` / `Filing#${accessionNumber}` | SEC_8K_FILED / SEC_PROSPECTUS_UPDATED / SEC_10K_UPDATED | `SubjectContext` (global) | sec-edgar-adpt/contracts | **NEW** |
| alpha-vantage-adpt | `AlphaVantageArticle`, `EconomicIndicator` | resp. / `Article#…`,`Indicator#${fn}` | ALPHA_VANTAGE_NEWS_UPDATED, ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED | `SubjectContext` (global) | alpha-vantage-adpt/contracts | **NEW** |
| fred-adpt | `FredIndicator` | `FredIndicator` / `Indicator#${seriesId}` | FRED_INDICATORS_UPDATED | `SubjectContext` (global) | fred-adpt/contracts | **NEW** |
| marketwatch-adpt | `MarketWatchArticle` | `MarketWatchArticle` / `Feed#${feedPath}` | MARKETWATCH_UPDATED | `SubjectContext` (global) | marketwatch-adpt/contracts | **NEW** |
| yahoo-finance-adpt | `YahooFinanceArticle` | `YahooFinanceArticle` / `Ticker#${ticker}` | YAHOO_FINANCE_UPDATED | `SubjectContext` (global) | yahoo-finance-adpt/contracts | **NEW** |

\* PE/AN AgentCompletion rows carry `tenantId` but no userId/region; `S = { tenantId }` (they are not RequestContext-complete). See real row shapes.

### Real persisted row shapes (the e2e gate validates THESE — verbatim from code 2026-06-10)

- **compliance-ctrl `ComplianceCheck`** — `handlers/event-listener.ts:66-88` (MANDATE_MISSING fallback) + `:130-146` (happy). Fields: `pk=ComplianceCheck#${tenantId}#${ccId}`, `sk='ComplianceCheck'`, `__typename='ComplianceCheck'`, `tenantId`, `ccId`(=ctx.eventId), `decisionPacketId`, `decisionId`(dual-field alias of decisionPacketId), `taskToken`, `mandateSnapshot:{level,status,operatingMode,effectiveDate}`, `status:'COMPLETED'|'BLOCKED'`, `result:'APPROVED'|'BLOCKED'`, `violations:[{rule,description,severity:'WARNING'|'BLOCKING'}]`, `authorityLevel:'L1'|'L2'`, `sourceEventId`. RuleEngine output enums verbatim from `rules/rule-engine.ts:33-37,45-49`. **No `proposedTrades` on this row** (proposedTrades rides RECOMMENDATION_PROPOSED, the inbound event — NOT DECISION_APPROVED). `S = RequestContext`. DECISION_APPROVED + DECISION_BLOCKED both carry THIS subject (CDC value-mapped on `result`).
- **advisory-adpt `ProposedTrade`** — `domain/index.ts:3-11`. `{ symbol, assetClass, side:'BUY'|'SELL', quantityOrAmountCents:number, targetWeightPercent:number, rationale }`. Imported by execution-ctrl ONLY (4 sites) as a type from `@nestfolio/advisory-adpt/domain`. Nests as `Order.proposedTrades[]` / `StagedOrder.proposedTrades[]` (execution-ctrl/contracts, currently `z.array(z.unknown())`).
- **investor-profile-ctrl `InvestorProfileSnapshot`** — contract EXISTS (`domain/contracts.ts`: `{agentOutput:{goals[],timeHorizon,riskWillingness,riskScore,riskCategory:enum,regulatoryFlags[],suitabilityAssessment,confidence}, sourceEventId?, __version?}`). Row `InvestorProfileSnapshotRow` (`domain/models.ts:37-57`) persisted at `handlers/event-listener.ts:94-105` via `update('InvestorProfileSnapshot', {tenantId,userId,agentOutput,sourceEventId,sourceEventType,agentInvocationId}, {add:{__version:1}, overrides:{pk:`InvestorProfileSnapshot#${tenantId}#${userId}`, sk:'InvestorProfileSnapshot'}})`. Row carries `tenantId`,`userId` (→ RequestContext; the row has NO `region` today — RequestContext ADDS it) + row-only `sourceEventType:'INVESTOR_PROFILE_UPDATED'|'MANDATE_ISSUED'` + `agentInvocationId` (NOT in the subject contract). `S = RequestContext`.
- **market-intelligence-ctrl `MarketSnapshot`** — contract EXISTS but **carries `region` in the subject** (`domain/contracts.ts`: `{region:z.string(), agentOutput:MarketAnalysisOutputSchema, __version?}`). Row `MarketSnapshotRow` (`domain/models.ts:38-59`) persisted via `update('MarketSnapshot', {region,agentOutput,slowComponentsAt?,fastComponentsAt,sourceEventIds,updatedAt}, {add:{__version:1}, overrides:{pk:`MarketSnapshot#${region}`, sk:'MarketSnapshot'}})` (`handlers/event-listener.ts:96-129`). **No `tenantId`** (region-scoped). Row-only fields `fastComponentsAt`,`slowComponentsAt`,`sourceEventIds`,`updatedAt` are NOT in the subject. `S = RegionContext`. `region` MUST drop from the subject schema into S.
- **DWC consumer reads `subject.region`** (`decision-workflow-ctrl/handlers/snapshot-projector.ts:55-78` `projectMarketSnapshot`) → the Task-4 co-change switches it to `ctx.region`.
- **portfolio-engine-ctrl `AgentCompletion`/`AgentFailure`** — `domain/models.ts:46-69` + `handlers/event-listener.ts:95-106,140-152`. Completion `{pk:`AgentCompletion#${decisionId}`, sk:`AgentCompletion#${agentName}`, __typename:'AgentCompletion', decisionId, tenantId, agentName:'portfolio-engine', taskToken, agentOutput, completedAt}`; failure `{…__typename:'AgentFailure', …, errorType, errorMessage, failedAt}`. `agentOutput = result` = composite `{decisionId, allocations:PortfolioConstruction, trades:RebalancePlan, metadata:{durationMs,modelTiers,modeUsed}}` (`agent-service.ts`). `S = { tenantId }`.
- **advisory-narrative-ctrl `AgentCompletion`/`AgentFailure`** — `domain/models.ts:38-61` + `handlers/event-listener.ts:112-123,156-169`. Identical shape, `agentName:'advisory-narrative'`. `agentOutput = result` = `{decisionId, ...explainability(summary,rationale,keyFactors,tone,wordCount,confidence), metadata:{durationMs,modelTier}}`. `S = { tenantId }`.
- **decision-workflow-ctrl CDC rows.** `DecisionPacket` (`repositories/decision-packet.repository.ts:34-56`): `pk=Decision#${tenantId}#${decisionId}`, `sk='DecisionPacket'`, `__typename`, `...ctx`(RequestContext), `timestamp`, `decisionId`, `trigger`, `triggerEventId`, `executionArn`, `explanation`, `proposedTrades`, `confirmationRequired`, `status:WorkflowStatus`, `__version`, `complianceResult`, `authorityLevel`, `userDecision`, `blockReason`, `rejectionReason`, `createdAt`, `updatedAt`. `MandateSnapshot` (`handlers/mandate-projector.ts:32-43`, projectVersioned): `{tenantId,userId,mandateId?,level?,operatingMode,effectiveDate?,status}`, pk=`MandateSnapshot#${tenantId}#${userId}`, sk='MandateSnapshot'. `S = RequestContext`.
- **decision-workflow-ctrl SF-direct subjects** (raw ASL in `constructs/decision-state-machine.ts`, NO row/`__typename` — contract-only): `RECOMMENDATION_PROPOSED` (`:204-242`): `{decisionId, tenantId, userId, taskToken, awaitingCompliance:true, proposedTrades, portfolioValueCents, isInitialBuild, riskCategory, currentPositions}` + context `{tenantId,userId,region}`. `DECISION_CYCLE_STARTED` (`:334-365`): `{decisionId, tenantId, status:'GENERATING', __version:0}`. `DECISION_CYCLE_FAILED` (`:706-737`): `{decisionId, tenantId, status:'FAILED', __version:1}`.
- **decision-workflow-ctrl local mirror rows** (`domain/models.ts:32-50`, NOT emitted — DWC's own projection of upstream snapshots): `InvestorProfileSnapshotProjectionRow {pk,sk:'InvestorProfileSnapshot',__typename,tenantId,userId,agentOutput:Record<string,unknown>,sourceEventId,updatedAt}` and `MarketSnapshotProjectionRow {pk:`MarketSnapshot#${region}`,sk,__typename,region,agentOutput:Record<string,unknown>,updatedAt}`. **`agentOutput` is persisted as a `JSON.stringify`'d STRING** (`snapshot-projector.ts:45,70`) for `States.StringToJson` SF consumption → the mirror row's `agentOutput` is genuinely `string`, NOT the structured object. `S = RequestContext` / `RegionContext`.
- **advisory-bff `DecisionReadModel`** — `transforms/decision-snapshot.ts:25-45` (projectVersioned): `{decisionId, tenantId, trigger, status, proposedTrades, explanation, confirmationRequired, confirmedAt?, rejectedAt?, rejectionReason?, complianceChecks:[], agentInvocations:[], version, taskToken?, createdAt, updatedAt}`, pk=`Decision#${tenantId}#${decisionId}`, sk='DecisionReadModel'. The minimal cycle-status builder (`decision-cycle-status.ts:28-43`) writes `{decisionId, tenantId, status, trigger:'', version, createdAt, updatedAt}`. `S = RequestContext`.
- **advisory-bff `UserConfirmation`/`UserRejection`** — emitted by JS resolvers (`graphql/js-function/confirm-decision.fn.js:31-48` / `reject-decision.fn.js:35-53`). Confirmation `{__typename:'UserConfirmation', tenantId, region, decisionId, confirmedAt, confirmedBy, timestamp, taskToken?}`, pk=`Decision#${tenantId}#${decisionId}`, sk=`UserConfirmation#${autoId}`. Rejection adds `rejectedAt`, `rejectedBy`, `rejectionReason`, sk=`UserRejection#${autoId}`. **JS resolvers can't import the TS contract at runtime** — the contract validates the emitted shape (unit + e2e), it is not imported by the producer.
- **feed adapters** — all GLOBAL (`SubjectContext`), `project()` injects `__typename` downstream so the validated `fields` object EXCLUDES `pk`/`sk`/`__typename`. `SecFiling` (`sec-edgar-adpt/domain/events.ts:10-22`) is the one interface that redundantly declares `pk`/`sk`/`__typename` — reconcile to fields-only. `FredIndicator {seriesId,label,date,value}`. `MarketWatchArticle {feed,source,articles:unknown[]}`. `YahooFinanceArticle {ticker,source,articles:unknown[]}`. alpha-vantage has NO interface (`AlphaVantageArticle` from raw `Record`, `EconomicIndicator` from `{function,data}` literal). Verbatim fields in Task 8.

### e2e validation surface (verified)

- The advisory decision cycle is driven end-to-end by the existing `/advisory` + dashboard e2e scenarios (`onboarded()` → a decision trigger → DWC SF → 4 real agents → compliance → DECISION_APPROVED → advisory-bff DecisionReadModel). This produces REAL `ComplianceCheck`, `DecisionPacket`, `MandateSnapshot`, `AgentCompletion` (PE+AN), DWC mirror rows, `DecisionReadModel`, `RECOMMENDATION_PROPOSED` rows. The gate reuses these fixtures (do NOT invent a new trigger).
- Feed adapters are driven by emitting `FETCH_<SOURCE>_REQUESTED` directly to each adapter (bus `advisory`) → the adapter fetches (real external API — e2e does NOT mock externals, [[feedback-e2e-no-external-mocks]]) → persists `SecFiling`/`FredIndicator`/etc. rows.
- `expectContractMatch(Schema, row, label)` at `apps/e2e-feature-tests/src/helpers/contract-assert.ts`; `poll()` at `…/helpers/poll.ts`; mirror `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts` + `…/investor/investor-contract-emission.e2e.test.ts`.
- `tenantId-index` GSI: PK=tenantId, SK=__typename, ProjectionType=ALL. Region/global rows (MarketSnapshot, SecFiling, FredIndicator…) carry NO tenantId → query by exact pk, not the GSI.

---

## File Structure

**Create:**
- `services/advisory/advisory-adpt/src/domain/contracts.ts` — `ProposedTradeSchema` + `ProposedTrade`.
- `services/advisory/advisory-adpt/test/unit/domain/contracts.test.ts`.
- `services/advisory/compliance-ctrl/src/domain/contracts.ts` — `ComplianceCheck`.
- `services/advisory/compliance-ctrl/test/unit/domain/contracts.test.ts`.
- `libs/agent-orchestrator/src/agent-completion-row.ts` — `AgentCompletionRow<A>`/`AgentFailureRow<A>` + `agentCompletionPk`/`agentCompletionSk`/`agentFailurePk`/`agentFailureSk` helpers.
- `libs/agent-orchestrator/test/agent-completion-row.test.ts`.
- `services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts` — `PortfolioAgentOutput`.
- `services/advisory/portfolio-engine-ctrl/test/unit/domain/contracts.test.ts`.
- `services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts` — `NarrativeAgentOutput`.
- `services/advisory/advisory-narrative-ctrl/test/unit/domain/contracts.test.ts`.
- `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts` — `DecisionPacket`, `MandateSnapshot`, `RecommendationProposed`, `DecisionCycleStarted`, `DecisionCycleFailed`, `IpSnapshotMirror`, `MarketSnapshotMirror`.
- `services/advisory/decision-workflow-ctrl/test/unit/domain/contracts.test.ts`.
- `services/advisory/advisory-bff/src/domain/contracts.ts` — `DecisionReadModel`, `UserConfirmation`, `UserRejection`.
- `services/advisory/advisory-bff/test/unit/domain/contracts.test.ts`.
- `services/advisory/sec-edgar-adpt/src/domain/contracts.ts`, `…/fred-adpt/…`, `…/alpha-vantage-adpt/…`, `…/marketwatch-adpt/…`, `…/yahoo-finance-adpt/…` (+ each `test/unit/domain/contracts.test.ts`).
- `apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts` — the #1-risk gate.

**Modify:**
- `services/advisory/advisory-adpt/src/domain/index.ts` — re-export `ProposedTrade` type + `ProposedTradeSchema` from `./contracts` (drop the inline interface). Import path `@nestfolio/advisory-adpt/domain` UNCHANGED for execution-ctrl.
- `services/advisory/compliance-ctrl/src/domain/schemas.ts` — DELETE (dead `DecisionApprovedSchema`/`DecisionBlockedSchema`). `domain/index.ts` — stop re-exporting them.
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` — type the 2 `record('ComplianceCheck', …)` subjects against `ComplianceCheck`.
- `services/advisory/investor-profile-ctrl/src/domain/models.ts` — `InvestorProfileSnapshotRow` → `TableEntry<InvestorProfileSnapshot, RequestContext> & {__typename; sourceEventType; agentInvocationId}`.
- `services/advisory/market-intelligence-ctrl/src/domain/contracts.ts` — drop `region` from `MarketSnapshotSchema`. `…/domain/models.ts` — `MarketSnapshotRow` → `TableEntry<MarketSnapshot, RegionContext> & {…row-only}`. `…/test/unit/domain/contracts.test.ts` — update the `region`-required assertions.
- `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` — `projectMarketSnapshot` reads `ctx.region` (REQUIRED co-change). `…/domain/models.ts` — mirror rows → `TableEntry<Subject, S>`. `…/handlers/mandate-projector.ts` — `parseSubject`. `…/handlers/assemble-packet.ts` — `AssemblePacketEvent` agent-output fields typed against the imported agent schemas.
- `services/advisory/portfolio-engine-ctrl/src/domain/models.ts` + `src/handlers/event-listener.ts` + `src/repositories/agent-completion.repository.ts` — use the shared generic; type `agentOutput`.
- `services/advisory/advisory-narrative-ctrl/src/domain/models.ts` + `src/handlers/event-listener.ts` + `src/repositories/agent-completion.repository.ts` — same.
- `libs/agent-orchestrator/src/index.ts` — export the new row module.
- `services/advisory/*/src/handlers/event-listener.ts` (5 feed adapters) — type the `project()` `fields` against the new schemas (where a clean annotation compiles).
- `tsconfig.base.json` — add `@nestfolio/advisory-adpt/contracts`, `@nestfolio/compliance-ctrl/contracts`, `@nestfolio/portfolio-engine-ctrl/contracts`, `@nestfolio/advisory-narrative-ctrl/contracts`, `@nestfolio/decision-workflow-ctrl/contracts`, `@nestfolio/advisory-bff/contracts`, `@nestfolio/sec-edgar-adpt/contracts`, `@nestfolio/alpha-vantage-adpt/contracts`, `@nestfolio/fred-adpt/contracts`, `@nestfolio/marketwatch-adpt/contracts`, `@nestfolio/yahoo-finance-adpt/contracts`.
- ~11 service `CLAUDE.md` cards (Task 11, via `audit-service`).

---

### Task 1: advisory-adpt — `ProposedTrade` interface → zod (completes the Execution slice's deferral)

**Files:**
- Create: `services/advisory/advisory-adpt/src/domain/contracts.ts`
- Modify: `services/advisory/advisory-adpt/src/domain/index.ts`
- Modify: `tsconfig.base.json`
- Test: `services/advisory/advisory-adpt/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/advisory/advisory-adpt/test/unit/domain/contracts.test.ts`:

```typescript
import { ProposedTradeSchema } from '../../../src/domain/contracts';

describe('advisory-adpt contracts', () => {
  it('ProposedTradeSchema parses a BUY trade', () => {
    const parsed = ProposedTradeSchema.parse({
      symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
      quantityOrAmountCents: 500000, targetWeightPercent: 60, rationale: 'core equity',
    });
    expect(parsed.symbol).toBe('VTI');
    expect(parsed.side).toBe('BUY');
  });

  it('ProposedTradeSchema rejects an invalid side', () => {
    expect(() => ProposedTradeSchema.parse({
      symbol: 'VTI', assetClass: 'EQUITY', side: 'HOLD',
      quantityOrAmountCents: 1, targetWeightPercent: 1, rationale: 'x',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run advisory-adpt:test --testPathPatterns contracts`
Expected: FAIL — module `../../../src/domain/contracts` does not exist. (If `advisory-adpt` has no `test` target yet — it currently has only `service.stack.test.ts` — confirm `pnpm nx show project advisory-adpt --json | grep test`; the project is `jest`-configured, so the target exists.)

- [ ] **Step 3: Create `domain/contracts.ts`** (imports ONLY zod):

```typescript
// Producer-owned value-object contracts for the advisory domain. Imports ONLY zod.
// ProposedTrade is advisory-produced; it nests inside the decision packet / order subjects
// (proposedTrades: ProposedTrade[]). execution-ctrl imports the TYPE cross-domain via
// @nestfolio/advisory-adpt/domain UNCHANGED — the import path is preserved by re-export.
import { z } from 'zod';

/** A proposed trade within a decision packet. */
export const ProposedTradeSchema = z.object({
  symbol: z.string(),
  assetClass: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  targetWeightPercent: z.number(),
  rationale: z.string(),
});
export type ProposedTrade = z.infer<typeof ProposedTradeSchema>;
```

- [ ] **Step 4: Rewire `domain/index.ts`** — replace the inline `interface ProposedTrade` with a re-export so the `@nestfolio/advisory-adpt/domain` import path stays valid for execution-ctrl:

```typescript
export { AdvisoryCrossDomainEventTypes, AdvisoryIngestEventTypes } from './events';
export { ProposedTradeSchema } from './contracts';
export type { ProposedTrade } from './contracts';
```

> The exported TYPE name `ProposedTrade` is unchanged and structurally identical (zod-inferred), so execution-ctrl's 4 importers (`order.repository.ts:5`, `event-listener.ts:8`, `safety-checks.service.ts:3`, `staged-order-processor.ts:3`) keep compiling untouched. The zod `enum(['BUY','SELL'])` infers `side: 'BUY' | 'SELL'` — identical to the old interface's union.

- [ ] **Step 5: Add the `/contracts` tsconfig path** (for the producer's own intra-domain consumers + the e2e gate) — in `tsconfig.base.json`, next to `@nestfolio/advisory-adpt/domain`:

```json
      "@nestfolio/advisory-adpt/contracts": ["services/advisory/advisory-adpt/src/domain/contracts.ts"],
```

- [ ] **Step 6: Run the test + lint + verify execution-ctrl still compiles**

Run: `pnpm nx run advisory-adpt:test --testPathPatterns contracts && pnpm nx run-many -t lint,typecheck -p advisory-adpt && pnpm nx run execution-ctrl:typecheck`
Expected: PASS — execution-ctrl compiles against the re-exported `ProposedTrade` type unchanged.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-adpt/src/domain services/advisory/advisory-adpt/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(advisory-adpt): convert ProposedTrade interface to zod contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 2: compliance-ctrl — `ComplianceCheck` contract (replace dead `DecisionApprovedSchema`)

**Files:**
- Create: `services/advisory/compliance-ctrl/src/domain/contracts.ts`
- Delete: `services/advisory/compliance-ctrl/src/domain/schemas.ts`
- Modify: `services/advisory/compliance-ctrl/src/domain/index.ts`, `src/handlers/event-listener.ts`, `tsconfig.base.json`
- Test: `services/advisory/compliance-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/advisory/compliance-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import { ComplianceCheckSchema } from '../../../src/domain/contracts';

describe('compliance-ctrl contracts', () => {
  it('ComplianceCheckSchema parses an APPROVED check subject (dry — identity stripped)', () => {
    const row = {
      pk: 'ComplianceCheck#t#cc1', sk: 'ComplianceCheck', __typename: 'ComplianceCheck',
      tenantId: 't', ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1',
      taskToken: 'tok', mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026-06-10T00:00:00.000Z' },
      status: 'COMPLETED', result: 'APPROVED', violations: [], authorityLevel: 'L1', sourceEventId: 'e1',
    };
    const parsed = ComplianceCheckSchema.parse(row);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.result).toBe('APPROVED');
    expect(parsed.ccId).toBe('cc1');
  });

  it('ComplianceCheckSchema parses a BLOCKED check with violations', () => {
    const parsed = ComplianceCheckSchema.parse({
      ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1', taskToken: 'tok',
      mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026' },
      status: 'BLOCKED', result: 'BLOCKED',
      violations: [{ rule: 'MANDATE_MISSING', description: 'No mandate', severity: 'BLOCKING' }],
      authorityLevel: 'L2', sourceEventId: 'e1',
    });
    expect(parsed.violations[0].severity).toBe('BLOCKING');
  });

  it('ComplianceCheckSchema rejects an unknown result', () => {
    expect(() => ComplianceCheckSchema.parse({
      ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1', taskToken: 'tok',
      mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026' },
      status: 'COMPLETED', result: 'ESCALATED', violations: [], authorityLevel: 'L1', sourceEventId: 'e1',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run compliance-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`** (imports ONLY zod):

```typescript
// Producer-owned event/row subject contracts for compliance-ctrl. Imports ONLY zod.
// Dry aggregate — identity (tenantId/userId/region) travels in the event context (RequestContext).
import { z } from 'zod';

/**
 * ComplianceCheck subject — the `ComplianceCheck` row (sk='ComplianceCheck') written by
 * event-listener on RECOMMENDATION_PROPOSED, CDC-emitted (value-mapped on `result`) as
 * DECISION_APPROVED (result=APPROVED) / DECISION_BLOCKED (result=BLOCKED). Enums verbatim from
 * rules/rule-engine.ts ComplianceOutput. `decisionId` is a dual-field alias of decisionPacketId
 * (advisory-bff keys its DecisionReadModel pk on `decisionId`; execution-ctrl/ledger-ctrl key on
 * `decisionPacketId`). `taskToken` is carried so decision-workflow-ctrl/sfn-callback can resume
 * the SF. The row carries NO proposedTrades (those ride RECOMMENDATION_PROPOSED).
 */
export const ComplianceCheckSchema = z.object({
  ccId: z.string(),
  decisionPacketId: z.string(),
  decisionId: z.string(),
  taskToken: z.string(),
  mandateSnapshot: z.object({
    level: z.enum(['ADVISORY', 'DISCRETIONARY']),
    status: z.enum(['ACTIVE', 'REVOKED']),
    operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
    effectiveDate: z.string(),
  }),
  status: z.enum(['COMPLETED', 'BLOCKED']),
  result: z.enum(['APPROVED', 'BLOCKED']),
  violations: z.array(z.object({
    rule: z.string(),
    description: z.string(),
    severity: z.enum(['WARNING', 'BLOCKING']),
  })),
  authorityLevel: z.enum(['L1', 'L2']),
  sourceEventId: z.string(),
});
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;
```

> Verify the enums against `rules/rule-engine.ts` (`ComplianceOutput.result: 'APPROVED'|'BLOCKED'`, `authorityLevel: 'L1'|'L2'`, `Violation.severity: 'WARNING'|'BLOCKING'`, `MandateSnapshot` shape — all confirmed 2026-06-10). The MANDATE_MISSING fallback writes `mandateSnapshot.operatingMode:'CONSERVATIVE'`, `status:'BLOCKED'`, `result:'BLOCKED'`, `authorityLevel:'L2'` — all covered.

- [ ] **Step 4: Delete `domain/schemas.ts` + rewire `domain/index.ts`**

Delete `services/advisory/compliance-ctrl/src/domain/schemas.ts` (the dead `DecisionApprovedSchema`/`DecisionBlockedSchema` — grep proved ZERO importers outside the `domain/index.ts` re-export). In `services/advisory/compliance-ctrl/src/domain/index.ts`, remove the `export … from './schemas'` line(s) and add:

```typescript
export { ComplianceCheckSchema } from './contracts';
export type { ComplianceCheck } from './contracts';
```

Run `grep -rn "DecisionApprovedSchema\|DecisionBlockedSchema\|DecisionApprovedEvent\|DecisionBlockedEvent" services libs apps` and confirm the only remaining hits are now-removed; delete any stragglers.

- [ ] **Step 5: Add the tsconfig path** — in `tsconfig.base.json`, next to `@nestfolio/compliance-ctrl/events`:

```json
      "@nestfolio/compliance-ctrl/contracts": ["services/advisory/compliance-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 6: Type the 2 `record('ComplianceCheck', …)` subjects** (behavior-preserving)

In `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`, `import type { ComplianceCheck } from '../domain/contracts';`. For both the MANDATE_MISSING fallback (`:66-88`) and the happy path (`:130-146`), extract a `const subject: ComplianceCheck = { ccId, decisionPacketId, decisionId: decisionPacketId, taskToken, mandateSnapshot: …, status: 'BLOCKED'|'COMPLETED', result, violations, authorityLevel, sourceEventId: ctx.eventId };` and pass `record('ComplianceCheck', { __typename: 'ComplianceCheck', tenantId, ...subject }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' })`.

> `taskToken` is typed `string` on the subject but is `string | undefined` at the call-site (`subject.taskToken as string | undefined`). The happy path already throws `NotRetryableError` if `taskToken` is missing (`:56-58`), so at the `record()` call-site it is non-null — assign `taskToken` (narrowed). The fallback path also has a non-null `taskToken` (same guard runs first). If TS still flags it, annotate `taskToken!`. Do NOT change emitted values.

- [ ] **Step 7: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p compliance-ctrl --testPathPatterns "contracts|event-listener"`
Expected: PASS. (`compliance-ctrl:typecheck` compiles the read-model-ownership type-test; `ComplianceCheck` stays P2 — unchanged.)

- [ ] **Step 8: Commit**

```bash
git add services/advisory/compliance-ctrl/src/domain services/advisory/compliance-ctrl/src/handlers/event-listener.ts services/advisory/compliance-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(compliance-ctrl): ComplianceCheck contract; drop dead DecisionApproved/Blocked schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 3: investor-profile-ctrl — `InvestorProfileSnapshotRow` → `TableEntry<InvestorProfileSnapshot>`

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/domain/models.ts`
- Test: `services/advisory/investor-profile-ctrl/test/unit/domain/contracts.test.ts` (the contract already exists + is tested; add a row-type compile assertion)

The contract `InvestorProfileSnapshotSchema` already exists and is DRY. This task only converts the hand-rolled `InvestorProfileSnapshotRow` interface to `TableEntry<Subject>`.

- [ ] **Step 1: Convert the row interface** — in `services/advisory/investor-profile-ctrl/src/domain/models.ts`, replace the inline `InvestorProfileSnapshotRow` interface (`:37-57`) with:

```typescript
import type { TableEntry, RequestContext } from '@nestfolio/event-processor';
import type { InvestorProfileSnapshot } from './contracts';

/**
 * Persisted InvestorProfileSnapshot row. The dry subject (agentOutput/sourceEventId/__version)
 * comes from the producer contract; identity (tenantId/userId/region) from RequestContext; the
 * remaining fields are row-only provenance (NOT on the emitted subject — consumers read them
 * from neither, they exist only for the row).
 */
export type InvestorProfileSnapshotRow = TableEntry<InvestorProfileSnapshot, RequestContext> & {
  readonly __typename: 'InvestorProfileSnapshot';
  readonly sourceEventType: 'INVESTOR_PROFILE_UPDATED' | 'MANDATE_ISSUED';
  readonly agentInvocationId: string;
};
```

> `TableEntry<InvestorProfileSnapshot, RequestContext>` already supplies `pk`/`sk`/`__typename`/`createdAt`/`updatedAt?`/`agentOutput`/`sourceEventId?`/`__version?`/`tenantId`/`userId`/`region`. The intersection adds the row-only `sourceEventType`+`agentInvocationId`. The row gains a `region` field from `RequestContext` (the CDC publisher already reads `record.region` for the emitted context — consistent). Keep the old `sk: 'InvestorProfileSnapshot'` literal narrowing via the `__typename` intersection; if any consumer of `InvestorProfileSnapshotRow` relied on `sk` being the literal `'InvestorProfileSnapshot'`, add `& { readonly sk: 'InvestorProfileSnapshot' }`.

- [ ] **Step 2: Verify the existing contract test still passes + add a row-type assertion** — append to `services/advisory/investor-profile-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import type { InvestorProfileSnapshotRow } from '../../../src/domain/models';

it('InvestorProfileSnapshotRow composes TableEntry<InvestorProfileSnapshot, RequestContext>', () => {
  const row: InvestorProfileSnapshotRow = {
    pk: 'InvestorProfileSnapshot#t#u', sk: 'InvestorProfileSnapshot', __typename: 'InvestorProfileSnapshot',
    tenantId: 't' as never, userId: 'u' as never, region: 'us-east-1', createdAt: '2026',
    agentOutput: { goals: [], timeHorizon: '5y', riskWillingness: 'moderate', riskScore: 5,
      riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'ok', confidence: 0.9 },
    sourceEventType: 'INVESTOR_PROFILE_UPDATED', agentInvocationId: 'inv-1',
  };
  expect(row.__typename).toBe('InvestorProfileSnapshot');
});
```

> `tenantId`/`userId` are branded (`TenantId`/`UserId`); the `as never` casts keep the test literal compiling without importing the brand helpers. This is a compile-time assertion (the test passing == the row type composes).

- [ ] **Step 3: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p investor-profile-ctrl --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/domain/models.ts services/advisory/investor-profile-ctrl/test/unit/domain/contracts.test.ts
git commit --no-verify -m "refactor(investor-profile-ctrl): InvestorProfileSnapshotRow as TableEntry<Subject>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 4: market-intelligence-ctrl — drop `region` → `RegionContext`; row → `TableEntry`; DWC co-change

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/contracts.ts`, `src/domain/models.ts`, `test/unit/domain/contracts.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` (REQUIRED co-change)

- [ ] **Step 1: Update the failing test FIRST** — in `services/advisory/market-intelligence-ctrl/test/unit/domain/contracts.test.ts`, REPLACE the assertions that require `region` ON the subject (`:28`, `:40-44`) with a DRY assertion:

```typescript
it('MarketSnapshotSchema is dry — region is NOT on the subject (it travels in RegionContext)', () => {
  const parsed = MarketSnapshotSchema.parse({
    region: 'us-east-1', // extra key — must be stripped, not required
    agentOutput: { signals: [], tickersMentioned: [], marketOutlook: 'neutral', confidenceScore: 0.5 },
    __version: 1,
  });
  expect('region' in parsed).toBe(false);
  expect(parsed.agentOutput.marketOutlook).toBe('neutral');
});

it('MarketSnapshotSchema still requires agentOutput', () => {
  expect(() => MarketSnapshotSchema.parse({ __version: 1 })).toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run market-intelligence-ctrl:test --testPathPatterns contracts`
Expected: FAIL — `'region' in parsed` is currently `true` (region is on the schema).

- [ ] **Step 3: Drop `region` from `MarketSnapshotSchema`** — in `services/advisory/market-intelligence-ctrl/src/domain/contracts.ts`:

```typescript
// Producer-owned event/row subject contracts for market-intelligence-ctrl. Imports ONLY zod.
import { z } from 'zod';
import { MarketAnalysisOutputSchema } from '../agents/schemas';

/**
 * MarketSnapshot subject — the `MarketSnapshot` row (sk='MarketSnapshot', pk=`MarketSnapshot#${region}`)
 * CDC-emitted as MARKET_SNAPSHOT_UPDATED. Region-scoped: `region` travels in RegionContext (the
 * event context), NOT on the subject. The persisted row still physically carries region (via S),
 * so the CDC publisher emits context.region from record.region.
 */
export const MarketSnapshotSchema = z.object({
  agentOutput: MarketAnalysisOutputSchema,
  __version: z.number().optional(),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run market-intelligence-ctrl:test --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 5: Convert `MarketSnapshotRow`** — in `services/advisory/market-intelligence-ctrl/src/domain/models.ts`, replace the inline `MarketSnapshotRow` (`:38-59`) with:

```typescript
import type { TableEntry, RegionContext } from '@nestfolio/event-processor';
import type { MarketSnapshot } from './contracts';

/** Persisted MarketSnapshot row. Region-scoped (RegionContext supplies `region`; no tenant). The
 * row-only operational fields are projection metadata, not part of the emitted business subject. */
export type MarketSnapshotRow = TableEntry<MarketSnapshot, RegionContext> & {
  readonly __typename: 'MarketSnapshot';
  readonly sk: 'MarketSnapshot';
  readonly fastComponentsAt: string;
  readonly slowComponentsAt?: string;
  readonly sourceEventIds: ReadonlyArray<string>;
};
```

> `TableEntry<MarketSnapshot, RegionContext>` = `MarketSnapshot & {pk,sk,__typename,createdAt,updatedAt?,ttl?} & {region}`. The intersection narrows `__typename`/`sk` + adds the row-only fields. The producer `update()` call (`event-listener.ts:96-129`) already writes `region` as a field — no change needed there; `region` is now sourced from `RegionContext` in the type, physically persisted.

- [ ] **Step 6: REQUIRED DWC co-change** — in `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`, `projectMarketSnapshot` currently reads `const region = subject.region;` (`:56`) but `parseSubject` now strips `region`. Change the signature + the read to source `region` from the event context (mirroring how `projectIpSnapshot`/`projectLedgerSnapshot` already read identity from `ctx`):

```typescript
function projectMarketSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent | undefined {
  const subject = parseSubject(payload, MarketSnapshotSchema);
  // region is a RegionContext field — it travels in the event context, not the (now dry) subject.
  const region = ctx.region;
  const agentOutput = subject.agentOutput;
  // ...unchanged...
}
```

Update the handler-map call site so `projectMarketSnapshot` receives `ctx` (find the `MARKET_SNAPSHOT_UPDATED` handler in `createHandlers` — it currently calls `projectMarketSnapshot(p)`; change to `projectMarketSnapshot(p, c)` matching the IP/Ledger handlers' `(p, c)` signature). `EventContext extends RequestContext`, so `ctx.region` is typed `string`.

- [ ] **Step 7: Run the touched suites + lint + typecheck (both services)**

Run: `pnpm nx run-many -t test,lint,typecheck -p market-intelligence-ctrl,decision-workflow-ctrl --testPathPatterns "contracts|snapshot-projector"`
Expected: PASS. The DWC `snapshot-projector` unit test (`test/unit/snapshot-projector.test.ts`) drives `projectMarketSnapshot` with a fixture — confirm its `ctx` fixture carries `region: 'us-east-1'` (it does, `:16-20`); the test's market fixture asserts `pk: 'MarketSnapshot#us-east-1'` which now derives from `ctx.region` — still `us-east-1`. If the test's market payload put `region` only on `subject` (not `ctx`), update the fixture to also set `ctx.region` (mirrors reality — CDC carries region in context).

- [ ] **Step 8: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/domain services/advisory/market-intelligence-ctrl/test/unit/domain/contracts.test.ts services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts
git commit --no-verify -m "refactor(market-intelligence-ctrl): MarketSnapshot region -> RegionContext; row as TableEntry; DWC reads ctx.region

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 5: agent-orchestrator — shared `AgentCompletionRow<A>` generic + PK/SK helpers

**Files:**
- Create: `libs/agent-orchestrator/src/agent-completion-row.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`
- Test: `libs/agent-orchestrator/test/agent-completion-row.test.ts`

- [ ] **Step 1: Write the failing test** — create `libs/agent-orchestrator/test/agent-completion-row.test.ts`:

```typescript
import {
  agentCompletionPk, agentCompletionSk, agentFailurePk, agentFailureSk,
  type AgentCompletionRow, type AgentFailureRow,
} from '../src/agent-completion-row';

describe('agent-completion-row helpers', () => {
  it('builds the AgentCompletion pk/sk', () => {
    expect(agentCompletionPk('dec-1')).toBe('AgentCompletion#dec-1');
    expect(agentCompletionSk('portfolio-engine')).toBe('AgentCompletion#portfolio-engine');
  });
  it('builds the AgentFailure pk/sk', () => {
    expect(agentFailurePk('dec-1')).toBe('AgentFailure#dec-1');
    expect(agentFailureSk('advisory-narrative')).toBe('AgentFailure#advisory-narrative');
  });
  it('AgentCompletionRow<A> is generic over the agentName literal + agentOutput', () => {
    const row: AgentCompletionRow<'portfolio-engine', { ok: boolean }> = {
      pk: 'AgentCompletion#d1', sk: 'AgentCompletion#portfolio-engine', __typename: 'AgentCompletion',
      decisionId: 'd1', tenantId: 't', agentName: 'portfolio-engine', taskToken: 'tok',
      agentOutput: { ok: true }, completedAt: '2026',
    };
    expect(row.agentName).toBe('portfolio-engine');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run agent-orchestrator:test --testPathPatterns agent-completion-row`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `agent-completion-row.ts`**:

```typescript
import type { TableEntry } from '@nestfolio/event-processor';

/** PK/SK key helpers for the per-agent SF-callback completion/failure rows. */
export const agentCompletionPk = (decisionId: string): string => `AgentCompletion#${decisionId}`;
export const agentCompletionSk = (agentName: string): string => `AgentCompletion#${agentName}`;
export const agentFailurePk = (decisionId: string): string => `AgentFailure#${decisionId}`;
export const agentFailureSk = (agentName: string): string => `AgentFailure#${agentName}`;

/**
 * Shared AgentCompletion row — a task-token agent's success callback row. `A` is the agentName
 * literal (e.g. 'portfolio-engine'); `O` is the agent's composite output subject (per-service
 * derived schema). Tenant-scoped only (no userId/region on the row). __typename is the literal
 * 'AgentCompletion'.
 */
export type AgentCompletionRow<A extends string, O = unknown> = TableEntry<
  {
    decisionId: string;
    agentName: A;
    taskToken: string;
    agentOutput: O;
    completedAt: string;
  },
  { tenantId: string }
> & { __typename: 'AgentCompletion' };

/** Shared AgentFailure row — a task-token agent's failure callback row. */
export type AgentFailureRow<A extends string> = TableEntry<
  {
    decisionId: string;
    agentName: A;
    taskToken: string;
    errorType: string;
    errorMessage: string;
    failedAt: string;
  },
  { tenantId: string }
> & { __typename: 'AgentFailure' };
```

- [ ] **Step 4: Export from the lib barrel** — in `libs/agent-orchestrator/src/index.ts`, add:

```typescript
export {
  agentCompletionPk, agentCompletionSk, agentFailurePk, agentFailureSk,
} from './agent-completion-row';
export type { AgentCompletionRow, AgentFailureRow } from './agent-completion-row';
```

- [ ] **Step 5: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p agent-orchestrator --testPathPatterns agent-completion-row`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/agent-completion-row.ts libs/agent-orchestrator/src/index.ts libs/agent-orchestrator/test/agent-completion-row.test.ts
git commit --no-verify -m "feat(agent-orchestrator): shared AgentCompletionRow<A>/AgentFailureRow<A> + key helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 6: portfolio-engine-ctrl — `PortfolioAgentOutput` contract + use the shared row generic

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/models.ts`, `src/repositories/agent-completion.repository.ts`, `src/handlers/event-listener.ts`, `tsconfig.base.json`
- Test: `services/advisory/portfolio-engine-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/advisory/portfolio-engine-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import { PortfolioAgentOutputSchema } from '../../../src/domain/contracts';

describe('portfolio-engine-ctrl contracts', () => {
  it('PortfolioAgentOutputSchema parses the composite runPipeline output', () => {
    const parsed = PortfolioAgentOutputSchema.parse({
      decisionId: 'd1',
      allocations: {
        allocations: [{ instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 60, rationale: 'core' }],
        totalExposure: 1, equityWeight: 0.6,
        riskMetrics: { concentrationRisk: 0.1, sectorDiversity: 0.8, largestPositionWeight: 0.6 },
        confidence: 0.9,
      },
      trades: { trades: [], estimatedTurnover: 0, confidence: 0.9 },
      metadata: { durationMs: 1200, modelTiers: { construction: 'sonnet' }, modeUsed: 'BALANCED' },
    });
    expect(parsed.decisionId).toBe('d1');
    expect(parsed.allocations.allocations[0].instrument).toBe('VTI');
  });

  it('PortfolioAgentOutputSchema tolerates an absent optional trades block', () => {
    expect(PortfolioAgentOutputSchema.parse({
      decisionId: 'd1',
      allocations: { allocations: [], totalExposure: 1, equityWeight: 0.6,
        riskMetrics: { concentrationRisk: 0, sectorDiversity: 0, largestPositionWeight: 0 }, confidence: 0.9 },
      metadata: { durationMs: 1 },
    }).trades).toBeUndefined();
  });
});
```

> Before writing the schema, OPEN `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts` and `src/agent-service.ts` and confirm the EXACT shape of `metadata` and whether `trades` is always present. The fixture above mirrors the agent-report shape (`PortfolioConstructionSchema` + `RebalancePlanSchema` + `{decisionId, metadata}`); adjust the test + schema to the verbatim `runPipeline` return. The #1-risk e2e gate (Task 9) is the final arbiter — if the real PORTFOLIO_COMPLETED row's `agentOutput` doesn't parse, FIX THE SCHEMA to match reality.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run portfolio-engine-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`** (reuses the agent schemas):

```typescript
// Producer-owned contracts for portfolio-engine-ctrl. Imports zod + the service's agent schemas.
// PortfolioAgentOutput is the COMPOSITE runPipeline return stored as AgentCompletion.agentOutput
// and CDC-emitted on PORTFOLIO_COMPLETED — NOT a bare PortfolioConstructionSchema instance.
import { z } from 'zod';
import { PortfolioConstructionSchema, RebalancePlanSchema } from '../agents/schemas';

export const PortfolioAgentOutputSchema = z.object({
  decisionId: z.string(),
  allocations: PortfolioConstructionSchema,
  trades: RebalancePlanSchema.optional(),
  metadata: z.object({
    durationMs: z.number(),
    modelTiers: z.record(z.string()).optional(),
    modeUsed: z.string().optional(),
  }).passthrough(),
});
export type PortfolioAgentOutput = z.infer<typeof PortfolioAgentOutputSchema>;
```

> `metadata` uses `.passthrough()` so additive metadata keys don't reject the real row (defensive against drift in a non-load-bearing field). Adjust `allocations`/`trades` to the verbatim `runPipeline` return confirmed in Step 1.

- [ ] **Step 4: Add the tsconfig path** — in `tsconfig.base.json`, next to `@nestfolio/portfolio-engine-ctrl/events`:

```json
      "@nestfolio/portfolio-engine-ctrl/contracts": ["services/advisory/portfolio-engine-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 5: Use the shared row generic** — in `services/advisory/portfolio-engine-ctrl/src/domain/models.ts`, DELETE the inline `AgentCompletionRow`/`AgentFailureRow` interfaces (`:46-69`) and re-export the typed instantiations:

```typescript
import type { AgentCompletionRow, AgentFailureRow } from '@nestfolio/agent-orchestrator';
import type { PortfolioAgentOutput } from './contracts';

export type PortfolioAgentCompletionRow = AgentCompletionRow<'portfolio-engine', PortfolioAgentOutput>;
export type PortfolioAgentFailureRow = AgentFailureRow<'portfolio-engine'>;
```

In `services/advisory/portfolio-engine-ctrl/src/repositories/agent-completion.repository.ts`, DELETE the local `AGENT_COMPLETION_PK/SK` helpers (`:15-23`) and import them from `@nestfolio/agent-orchestrator` (`agentCompletionPk`/`agentCompletionSk`/`agentFailurePk`/`agentFailureSk`). Update call sites.

- [ ] **Step 6: Type the completion `record()` `agentOutput`** — in `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`, the completion `record('AgentCompletion', { …, agentOutput: result, … })` — annotate the result as `PortfolioAgentOutput` where it's built (in `agent-service.ts`'s `runPipeline` return type, or cast at the record call-site: `agentOutput: result as PortfolioAgentOutput`). Prefer typing `runPipeline`'s return; fall back to the call-site annotation if the pipeline return is widely shared. **Skip if it forces non-trivial churn** — the e2e gate validates the real emission regardless.

- [ ] **Step 7: Run the touched suites + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p portfolio-engine-ctrl --testPathPatterns "contracts|event-listener|agent-completion"`
Expected: PASS. (Confirm `service.stack.test.ts` CDC `AgentCompletion`/`AgentFailure` mapping is untouched.)

- [ ] **Step 8: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/domain services/advisory/portfolio-engine-ctrl/src/repositories/agent-completion.repository.ts services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts services/advisory/portfolio-engine-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(portfolio-engine-ctrl): PortfolioAgentOutput contract; shared AgentCompletionRow generic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 7: advisory-narrative-ctrl — `NarrativeAgentOutput` contract + use the shared row generic

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/models.ts`, `src/repositories/agent-completion.repository.ts`, `src/handlers/event-listener.ts`, `tsconfig.base.json`
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/advisory/advisory-narrative-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import { NarrativeAgentOutputSchema } from '../../../src/domain/contracts';

describe('advisory-narrative-ctrl contracts', () => {
  it('NarrativeAgentOutputSchema parses the composite runPipeline output (explainability spread)', () => {
    const parsed = NarrativeAgentOutputSchema.parse({
      decisionId: 'd1', summary: 'Bought VTI', rationale: 'core equity', keyFactors: ['risk'],
      tone: 'neutral', wordCount: 42, confidence: 0.9,
      metadata: { durationMs: 800, modelTier: 'haiku' },
    });
    expect(parsed.summary).toBe('Bought VTI');
    expect(parsed.decisionId).toBe('d1');
  });

  it('NarrativeAgentOutputSchema rejects when summary is absent', () => {
    expect(() => NarrativeAgentOutputSchema.parse({
      decisionId: 'd1', rationale: 'x', keyFactors: [], tone: 'neutral', wordCount: 1, confidence: 0.5,
      metadata: { durationMs: 1, modelTier: 'haiku' },
    })).toThrow();
  });
});
```

> Confirm the exact `runPipeline` return in `advisory-narrative-ctrl/src/agent-service.ts` (`{decisionId, ...explainability, metadata:{durationMs, modelTier}}`) and `ExplainabilitySchema` in `src/agents/schemas.ts` before finalizing.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run advisory-narrative-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`**:

```typescript
// Producer-owned contracts for advisory-narrative-ctrl. Imports zod + the service's agent schemas.
// NarrativeAgentOutput is the COMPOSITE runPipeline return (ExplainabilitySchema spread at top
// level + decisionId + metadata) stored as AgentCompletion.agentOutput and CDC-emitted on
// NARRATIVE_COMPLETED.
import { z } from 'zod';
import { ExplainabilitySchema } from '../agents/schemas';

export const NarrativeAgentOutputSchema = ExplainabilitySchema.extend({
  decisionId: z.string(),
  metadata: z.object({
    durationMs: z.number(),
    modelTier: z.string().optional(),
  }).passthrough(),
});
export type NarrativeAgentOutput = z.infer<typeof NarrativeAgentOutputSchema>;
```

> `ExplainabilitySchema.extend(...)` spreads the explainability fields (summary/rationale/keyFactors/tone/wordCount/confidence) at the top level + adds decisionId/metadata — matching the `{decisionId, ...explainability, metadata}` runPipeline return. If `ExplainabilitySchema` is not a `z.object` (e.g. has refinements), fall back to `z.object({ ...ExplainabilitySchema.shape, decisionId, metadata })`.

- [ ] **Step 4: Add the tsconfig path**:

```json
      "@nestfolio/advisory-narrative-ctrl/contracts": ["services/advisory/advisory-narrative-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 5: Use the shared row generic** — in `services/advisory/advisory-narrative-ctrl/src/domain/models.ts`, DELETE the inline `AgentCompletionRow`/`AgentFailureRow` (`:38-61`) and re-export:

```typescript
import type { AgentCompletionRow, AgentFailureRow } from '@nestfolio/agent-orchestrator';
import type { NarrativeAgentOutput } from './contracts';

export type NarrativeAgentCompletionRow = AgentCompletionRow<'advisory-narrative', NarrativeAgentOutput>;
export type NarrativeAgentFailureRow = AgentFailureRow<'advisory-narrative'>;
```

In `services/advisory/advisory-narrative-ctrl/src/repositories/agent-completion.repository.ts`, DELETE the local PK/SK helpers and import them from `@nestfolio/agent-orchestrator`.

- [ ] **Step 6: Type the completion `agentOutput`** — same approach as Task 6 Step 6 (`agentOutput: result as NarrativeAgentOutput` or type `runPipeline`). Note `event-listener.ts:108` still calls `wrapAgentOutput(result)` (vestigial size-guard) — leave it; the `an-ctrl-wrap-agent-output-vestigial` cleanup is a separate parked item.

- [ ] **Step 7: Run the touched suites + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p advisory-narrative-ctrl --testPathPatterns "contracts|event-listener|agent-completion"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/domain services/advisory/advisory-narrative-ctrl/src/repositories/agent-completion.repository.ts services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts services/advisory/advisory-narrative-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(advisory-narrative-ctrl): NarrativeAgentOutput contract; shared AgentCompletionRow generic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 8: decision-workflow-ctrl — DWC contracts (CDC + SF-direct + mirror rows) + AssemblePacket typing

This is the richest task. DWC emits 3 CDC events (row images) + 3 SF-direct events (raw ASL, contract-only), holds 2 local mirror rows (agentOutput stored as JSON string), and has the Tier-3 `AssemblePacketEvent` to type against the agent schemas.

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/domain/contracts.ts`
- Modify: `src/domain/models.ts`, `src/handlers/mandate-projector.ts`, `src/handlers/assemble-packet.ts`, `tsconfig.base.json`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/domain/contracts.test.ts`

- [ ] **Step 1: Write the failing test** — create `services/advisory/decision-workflow-ctrl/test/unit/domain/contracts.test.ts`:

```typescript
import {
  DecisionPacketSchema, MandateSnapshotSchema, RecommendationProposedSchema,
  DecisionCycleStartedSchema, DecisionCycleFailedSchema,
} from '../../../src/domain/contracts';

describe('decision-workflow-ctrl contracts', () => {
  it('DecisionPacketSchema parses a PENDING packet (dry — identity stripped)', () => {
    const parsed = DecisionPacketSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1',
      decisionId: 'd1', trigger: 'DEPOSIT', triggerEventId: 'e1', executionArn: null,
      explanation: '', proposedTrades: [], confirmationRequired: false, status: 'PENDING',
      __version: 1, complianceResult: null, authorityLevel: null, userDecision: null,
      blockReason: null, rejectionReason: null, timestamp: '2026', createdAt: '2026', updatedAt: '2026',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('PENDING');
  });

  it('RecommendationProposedSchema parses the SF-direct subject', () => {
    const parsed = RecommendationProposedSchema.parse({
      decisionId: 'd1', taskToken: 'tok', awaitingCompliance: true,
      proposedTrades: [], portfolioValueCents: 100000, isInitialBuild: true,
      riskCategory: 'MODERATE', currentPositions: [],
    });
    expect(parsed.awaitingCompliance).toBe(true);
  });

  it('DecisionCycleStartedSchema parses GENERATING(v0); DecisionCycleFailedSchema parses FAILED(v1)', () => {
    expect(DecisionCycleStartedSchema.parse({ decisionId: 'd1', status: 'GENERATING', __version: 0 }).status).toBe('GENERATING');
    expect(DecisionCycleFailedSchema.parse({ decisionId: 'd1', status: 'FAILED', __version: 1 }).status).toBe('FAILED');
  });

  it('MandateSnapshotSchema parses the mandate mirror subject', () => {
    expect(MandateSnapshotSchema.parse({
      mandateId: 'm1', level: 'ADVISORY', operatingMode: 'CONSERVATIVE', effectiveDate: '2026', status: 'ACTIVE',
    }).operatingMode).toBe('CONSERVATIVE');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run decision-workflow-ctrl:test --testPathPatterns contracts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`**:

```typescript
// Producer-owned event/row subject contracts for decision-workflow-ctrl. Imports ONLY zod.
// Dry aggregates — identity (tenantId/userId/region) travels in the event context.
import { z } from 'zod';

/** DecisionPacket subject — the `DecisionPacket` row (sk='DecisionPacket', pk=`Decision#${tenantId}#${decisionId}`),
 * CDC-emitted as DECISION_PACKET_CREATED (insert) / DECISION_PACKET_UPDATED (modify). */
export const DecisionPacketSchema = z.object({
  decisionId: z.string(),
  trigger: z.string(),
  triggerEventId: z.string(),
  executionArn: z.string().nullable(),
  explanation: z.string(),
  proposedTrades: z.array(z.unknown()),
  confirmationRequired: z.boolean(),
  status: z.string(),
  __version: z.number(),
  complianceResult: z.string().nullable(),
  authorityLevel: z.string().nullable(),
  userDecision: z.string().nullable(),
  blockReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  timestamp: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionPacket = z.infer<typeof DecisionPacketSchema>;

/** MandateSnapshot subject — the `MandateSnapshot` row (sk='MandateSnapshot'), CDC-emitted as
 * MANDATE_SNAPSHOT_CREATED. Projected from the inbound Mandate events. */
export const MandateSnapshotSchema = z.object({
  mandateId: z.string().optional(),
  level: z.string().optional(),
  operatingMode: z.string(),
  effectiveDate: z.string().optional(),
  status: z.string(),
});
export type MandateSnapshot = z.infer<typeof MandateSnapshotSchema>;

/** RECOMMENDATION_PROPOSED subject — SF-direct (raw ASL in decision-state-machine.ts, no row/__typename).
 * Carries the packet data + taskToken to compliance-ctrl. */
export const RecommendationProposedSchema = z.object({
  decisionId: z.string(),
  taskToken: z.string(),
  awaitingCompliance: z.literal(true),
  proposedTrades: z.array(z.unknown()),
  portfolioValueCents: z.number(),
  isInitialBuild: z.boolean(),
  riskCategory: z.string(),
  currentPositions: z.array(z.unknown()),
});
export type RecommendationProposed = z.infer<typeof RecommendationProposedSchema>;

/** DECISION_CYCLE_STARTED subject — SF-direct fire-and-forget. */
export const DecisionCycleStartedSchema = z.object({
  decisionId: z.string(),
  status: z.literal('GENERATING'),
  __version: z.literal(0),
});
export type DecisionCycleStarted = z.infer<typeof DecisionCycleStartedSchema>;

/** DECISION_CYCLE_FAILED subject — SF-direct, shared pre-packet Catch. */
export const DecisionCycleFailedSchema = z.object({
  decisionId: z.string(),
  status: z.literal('FAILED'),
  __version: z.literal(1),
});
export type DecisionCycleFailed = z.infer<typeof DecisionCycleFailedSchema>;
```

> `DecisionPacket.status` / `MandateSnapshot.level` etc. are typed `z.string()` rather than a strict enum to avoid rejecting a real `WorkflowStatus`/`MandateLevel` value not yet enumerated — confirm the `WorkflowStatus` union in `domain/models.ts` and tighten to an enum ONLY if the full set is certain (the e2e gate validates the real emission). `RECOMMENDATION_PROPOSED`'s `proposedTrades` is `z.array(z.unknown())` (it carries `ProposedTrade[]`; tighten to `z.array(ProposedTradeSchema)` from `@nestfolio/advisory-adpt/domain` if desired — both advisory, intra-domain import is fine).

- [ ] **Step 4: Add the tsconfig path**:

```json
      "@nestfolio/decision-workflow-ctrl/contracts": ["services/advisory/decision-workflow-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 5: Convert the local mirror rows** — in `services/advisory/decision-workflow-ctrl/src/domain/models.ts`, replace `InvestorProfileSnapshotProjectionRow` (`:32-41`) + `MarketSnapshotProjectionRow` (`:43-50`) with `TableEntry<Subject>`. NOTE: the mirror stores `agentOutput` as a **JSON-stringified string** (`snapshot-projector.ts:45,70`), so the mirror subject's `agentOutput` is `string`, NOT the producer's structured object:

```typescript
import type { TableEntry, RequestContext, RegionContext } from '@nestfolio/event-processor';

/** DWC-local mirror of the upstream InvestorProfileSnapshot. agentOutput is stored JSON-stringified
 * for States.StringToJson SF consumption — hence `string`, not the producer's structured object. */
export type InvestorProfileSnapshotProjectionRow = TableEntry<
  { agentOutput: string; sourceEventId: string },
  RequestContext
> & { readonly __typename: 'InvestorProfileSnapshot'; readonly sk: 'InvestorProfileSnapshot' };

/** DWC-local mirror of the upstream MarketSnapshot (region-scoped). agentOutput JSON-stringified. */
export type MarketSnapshotProjectionRow = TableEntry<
  { agentOutput: string },
  RegionContext
> & { readonly __typename: 'MarketSnapshot'; readonly sk: 'MarketSnapshot' };
```

> If any DWC code reads `InvestorProfileSnapshotProjectionRow.agentOutput` as an object, it must already `JSON.parse` it (the row stores a string) — leave those reads unchanged; the type now correctly says `string`.

- [ ] **Step 6: Add `parseSubject` to `mandate-projector.ts`** — `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts` currently reads `subject.<field> as …` casts (no validation). Replace the cast-reads with `const subject = parseSubject(payload, MandateSnapshotSchema);` (import `parseSubject` from `@nestfolio/event-processor` + `MandateSnapshotSchema` from `../domain/contracts`), then read `subject.mandateId`/`subject.level`/`subject.operatingMode`/`subject.effectiveDate`/`subject.status` typed. Keep `tenantId`/`userId` from `ctx`. Keep the `__version`/`operatingMode`-missing guards (read `payload.subject.__version` for the version, since `MandateSnapshotSchema` does not include `__version`; OR add `__version: z.number().optional()` to the schema and read `subject.__version`).

> The mandate event is INBOUND (MANDATE_ISSUED/OPERATING_MODE_CHANGED/MANDATE_REVOKED from investor-bff). Its producer schema lives in investor-bff. DWC parsing it via a DWC-local `MandateSnapshotSchema` is a consumer-side validation convenience — acceptable here because DWC also PRODUCES the MandateSnapshot mirror row with the same shape. If `parseSubject` against the strict schema rejects a real inbound mandate event in the e2e gate, widen the schema to match the real investor-bff emission (reality wins).

- [ ] **Step 7: Type `AssemblePacketEvent` against the agent schemas** — in `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`, replace the four `Record<string, unknown> | null` agent-output fields (`:30-36`) with the imported producer output schemas (`z.infer` types):

```typescript
import type { InvestorProfileSnapshot } from '@nestfolio/investor-profile-ctrl/contracts';
import type { MarketSnapshot } from '@nestfolio/market-intelligence-ctrl/contracts';
import type { PortfolioAgentOutput } from '@nestfolio/portfolio-engine-ctrl/contracts';
import type { NarrativeAgentOutput } from '@nestfolio/advisory-narrative-ctrl/contracts';

interface AssemblePacketEvent {
  // ...existing scalar fields unchanged...
  investorProfile?: InvestorProfileSnapshot['agentOutput'] | null;
  marketAnalysis?: MarketSnapshot['agentOutput'] | null;
  portfolio?: PortfolioAgentOutput | null;
  narrative?: NarrativeAgentOutput | null;
  ledgerSnapshot?: LedgerSnapshotState;
}
```

> The SF plumbs `$.agentResults.<Upstream>.agentOutput` into these fields. `investorProfile`/`marketAnalysis` are the agentOutput SUB-object (hence `['agentOutput']`); `portfolio`/`narrative` are the full composite output. The handler reads `investorProfile?.riskCategory` (`:191`), `portfolio.allocations.allocations` (`:105-106`), `narrative?.rationale ?? narrative?.summary` (`:198-201`) — all now type-resolve against these schemas. If a read references a field not on the schema (e.g. a path the SF reshapes), keep that single field optional/loosened rather than reverting the whole type. The `assemble-packet.test.ts` fixtures (currently `as any` object literals) keep compiling; tighten the most-used fixtures opportunistically.

- [ ] **Step 8: Run the touched suites + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p decision-workflow-ctrl --testPathPatterns "contracts|mandate-projector|assemble-packet"`
Expected: PASS. (`decision-workflow-ctrl:typecheck` compiles the read-model-ownership type-test — `DecisionPacket` CommandOwned, mirrors Projection<'P1'> — unchanged.)

- [ ] **Step 9: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts services/advisory/decision-workflow-ctrl/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(decision-workflow-ctrl): DWC contracts (CDC + SF-direct), mirror rows as TableEntry, AssemblePacket typed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 9: advisory-bff — `DecisionReadModel` / `UserConfirmation` / `UserRejection` contracts

**Files:**
- Create: `services/advisory/advisory-bff/src/domain/contracts.ts`
- Modify: `tsconfig.base.json`
- Test: `services/advisory/advisory-bff/test/unit/domain/contracts.test.ts`

advisory-bff's producers are projection transforms (`projectVersioned('DecisionReadModel', …)`) + JS `.fn.js` resolver intent rows. The contracts validate the emitted shapes (JS resolvers can't import TS at runtime). This task is contract-authoring only (no row-type swap — the projectVersioned image isn't a hand-rolled interface).

- [ ] **Step 1: Write the failing test** — create `services/advisory/advisory-bff/test/unit/domain/contracts.test.ts`:

```typescript
import { DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema } from '../../../src/domain/contracts';

describe('advisory-bff contracts', () => {
  it('DecisionReadModelSchema parses the projected decision read-model subject (dry)', () => {
    const parsed = DecisionReadModelSchema.parse({
      tenantId: 't', decisionId: 'd1', trigger: 'DEPOSIT', status: 'GENERATING',
      proposedTrades: [], explanation: '', confirmationRequired: false,
      complianceChecks: [], agentInvocations: [], version: 1, createdAt: '2026', updatedAt: '2026',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.decisionId).toBe('d1');
  });

  it('UserConfirmationSchema parses the resolver intent subject (decisionId + taskToken guaranteed)', () => {
    const parsed = UserConfirmationSchema.parse({
      tenantId: 't', region: 'us-east-1', decisionId: 'd1',
      confirmedAt: '2026', confirmedBy: 'u', timestamp: '2026', taskToken: 'tok',
    });
    expect(parsed.decisionId).toBe('d1');
    expect(parsed.taskToken).toBe('tok');
  });

  it('UserRejectionSchema parses the resolver intent subject (rejectionReason present)', () => {
    expect(UserRejectionSchema.parse({
      tenantId: 't', region: 'us-east-1', decisionId: 'd1',
      rejectedAt: '2026', rejectedBy: 'u', rejectionReason: 'changed mind', timestamp: '2026',
    }).rejectionReason).toBe('changed mind');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx run advisory-bff:test --testPathPatterns contracts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`**:

```typescript
// Producer-owned subject contracts for advisory-bff. Imports ONLY zod.
// advisory-bff producers: projectVersioned('DecisionReadModel', …) (CDC: DECISION_READ_MODEL_*)
// and JS .fn.js resolver intent rows UserConfirmation/UserRejection (CDC: USER_CONFIRMED/REJECTED).
// JS resolvers can't import this at runtime — these contracts validate the emitted shape (unit + e2e).
import { z } from 'zod';

/** DecisionReadModel subject — the `DecisionReadModel` row (sk='DecisionReadModel',
 * pk=`Decision#${tenantId}#${decisionId}`) projected from upstream decision events, CDC-emitted as
 * DECISION_READ_MODEL_CREATED/UPDATED. `version` is the projected image's version field. */
export const DecisionReadModelSchema = z.object({
  decisionId: z.string(),
  trigger: z.string(),
  status: z.string(),
  proposedTrades: z.array(z.unknown()),
  explanation: z.string(),
  confirmationRequired: z.boolean(),
  confirmedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  complianceChecks: z.array(z.unknown()),
  agentInvocations: z.array(z.unknown()),
  version: z.number(),
  taskToken: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionReadModel = z.infer<typeof DecisionReadModelSchema>;

/** UserConfirmation subject — the `UserConfirmation#${autoId}` intent row written by the
 * confirmDecision JS resolver, CDC-emitted as USER_CONFIRMED. decisionId + taskToken MUST be
 * present (decision-workflow-ctrl/sfn-callback drops the SF resume if decisionId is absent). */
export const UserConfirmationSchema = z.object({
  decisionId: z.string(),
  confirmedAt: z.string(),
  confirmedBy: z.string(),
  timestamp: z.string(),
  taskToken: z.string().optional(),
});
export type UserConfirmation = z.infer<typeof UserConfirmationSchema>;

/** UserRejection subject — the `UserRejection#${autoId}` intent row written by the rejectDecision
 * JS resolver, CDC-emitted as USER_REJECTED. */
export const UserRejectionSchema = z.object({
  decisionId: z.string(),
  rejectedAt: z.string(),
  rejectedBy: z.string(),
  rejectionReason: z.string(),
  timestamp: z.string(),
  taskToken: z.string().optional(),
});
export type UserRejection = z.infer<typeof UserRejectionSchema>;
```

> `region` is on the resolver intent row but is identity (RequestContext) → DRY: not on the subject; the DRY-test asserts `'region' in parsed` is stripped where present. The cycle-status builder (`decision-cycle-status.ts`) writes a minimal `DecisionReadModel` (`{decisionId, tenantId, status, trigger:'', version, createdAt, updatedAt}`) — covered by `DecisionReadModelSchema` (the extra fields are all `.optional()` or arrays defaulting empty; `proposedTrades`/`explanation`/`confirmationRequired`/`complianceChecks`/`agentInvocations` ARE required, but the cycle-status row omits them → either add them to the cycle-status builder OR make them optional in the schema). **Verify against `decision-cycle-status.ts`: if it omits those fields, mark them `.optional()` in the schema so BOTH builders' rows parse** (reality: two builders, one schema).

- [ ] **Step 4: Add the tsconfig path**:

```json
      "@nestfolio/advisory-bff/contracts": ["services/advisory/advisory-bff/src/domain/contracts.ts"],
```

- [ ] **Step 5: Run the test + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p advisory-bff --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-bff/src/domain/contracts.ts services/advisory/advisory-bff/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(advisory-bff): DecisionReadModel/UserConfirmation/UserRejection contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 10: feed adapters — `SecFiling` / `FredIndicator` / `AlphaVantage*` / `MarketWatchArticle` / `YahooFinanceArticle` contracts

All 5 are GLOBAL (`SubjectContext`). `project()` injects `__typename` downstream, so each contract validates the `fields` object (NO `pk`/`sk`/`__typename`). Do all 5 in one task (they share the pattern); one commit per adapter to keep diffs small, OR one combined commit.

For EACH adapter: (1) create `src/domain/contracts.ts`, (2) add the tsconfig `/contracts` path, (3) write `test/unit/domain/contracts.test.ts`, (4) where a clean annotation compiles, type the `project('<Typename>', fields, …)` `fields` arg against the schema's inferred type.

- [ ] **Step 1: sec-edgar-adpt** — `services/advisory/sec-edgar-adpt/src/domain/contracts.ts`:

```typescript
// Producer-owned contract for sec-edgar-adpt. Imports ONLY zod. GLOBAL aggregate (SubjectContext).
import { z } from 'zod';

/** SecFiling subject — the `SecFiling` row (pk=`SecFiling#${cik}`, sk=`Filing#${accessionNumber}`),
 * CDC-emitted (field-mapped on formType) as SEC_8K_FILED / SEC_PROSPECTUS_UPDATED / SEC_10K_UPDATED.
 * Global — no tenant/region. `project()` injects pk/sk/__typename, so the subject is fields-only. */
export const SecFilingSchema = z.object({
  cik: z.string(),
  issuer: z.string(),
  formType: z.string(),
  filingDate: z.string(),
  accessionNumber: z.string(),
  body: z.string(),
  source: z.literal('sec-edgar'),
  fetchedAt: z.string(),
});
export type SecFiling = z.infer<typeof SecFilingSchema>;
```

Then in `src/domain/events.ts`, the existing `interface SecFiling` redundantly declares `pk`/`sk`/`__typename` (`:10-22`) — DELETE that interface (replaced by the zod contract) and update `domain/index.ts` to re-export from `./contracts`. Verify the handler's `Omit<SecFiling,'__typename'|'pk'|'sk'>` (`event-listener.ts:104`) → change to type the `project('SecFiling', filingData, …)` `filingData` against `SecFiling` (which is now fields-only — no Omit needed). Test asserts a real filing parses + `source` rejects a wrong literal.

- [ ] **Step 2: fred-adpt** — `services/advisory/fred-adpt/src/domain/contracts.ts`:

```typescript
import { z } from 'zod';

/** FredIndicator subject — the `FredIndicator` row (pk='Fred#SYSTEM', sk=`Indicator#${seriesId}`),
 * CDC-emitted as FRED_INDICATORS_UPDATED. Global. */
export const FredIndicatorSchema = z.object({
  seriesId: z.string(),
  label: z.string(),
  date: z.string(),
  value: z.string(),
});
export type FredIndicator = z.infer<typeof FredIndicatorSchema>;
```

Replace `interface FredIndicator` in `domain/events.ts` with the re-export; type the `project('FredIndicator', indicator, …)`.

- [ ] **Step 3: marketwatch-adpt** — `services/advisory/marketwatch-adpt/src/domain/contracts.ts`:

```typescript
import { z } from 'zod';

/** MarketWatchArticle subject — the `MarketWatchArticle` row (pk='MarketWatch#SYSTEM',
 * sk=`Feed#${feedPath}`), CDC-emitted as MARKETWATCH_UPDATED. Global. RSS items unmodeled. */
export const MarketWatchArticleSchema = z.object({
  feed: z.string(),
  source: z.string(),
  articles: z.array(z.unknown()),
});
export type MarketWatchArticle = z.infer<typeof MarketWatchArticleSchema>;
```

Replace the interface; type the `project('MarketWatchArticle', …)`.

- [ ] **Step 4: yahoo-finance-adpt** — `services/advisory/yahoo-finance-adpt/src/domain/contracts.ts`:

```typescript
import { z } from 'zod';

/** YahooFinanceArticle subject — the `YahooFinanceArticle` row (pk='YahooFinance#SYSTEM',
 * sk=`Ticker#${ticker}`), CDC-emitted as YAHOO_FINANCE_UPDATED. Global. */
export const YahooFinanceArticleSchema = z.object({
  ticker: z.string(),
  source: z.string(),
  articles: z.array(z.unknown()),
});
export type YahooFinanceArticle = z.infer<typeof YahooFinanceArticleSchema>;
```

Replace the interface; type the `project('YahooFinanceArticle', …)`.

- [ ] **Step 5: alpha-vantage-adpt** (TWO typenames, NO existing interface) — `services/advisory/alpha-vantage-adpt/src/domain/contracts.ts`:

```typescript
import { z } from 'zod';

/** AlphaVantageArticle subject — the `AlphaVantageArticle` row (pk='AlphaVantage#SYSTEM',
 * sk=`Article#${ticker}#${dateStr}#${i}`), CDC-emitted as ALPHA_VANTAGE_NEWS_UPDATED. Global.
 * The article comes raw from the feed — model the fields the producer/consumers rely on, passthrough
 * the rest (open the feed payload in event-listener.ts to confirm the keys before tightening). */
export const AlphaVantageArticleSchema = z.object({}).passthrough();
export type AlphaVantageArticle = z.infer<typeof AlphaVantageArticleSchema>;

/** EconomicIndicator subject — the `EconomicIndicator` row (pk='AlphaVantage#SYSTEM',
 * sk=`Indicator#${fn}`), CDC-emitted as ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED. Global.
 * NOTE: typename `EconomicIndicator` is distinct from fred's `FredIndicator`. */
export const EconomicIndicatorSchema = z.object({
  function: z.string(),
  data: z.unknown(),
});
export type EconomicIndicator = z.infer<typeof EconomicIndicatorSchema>;
```

> `AlphaVantageArticle` is projected from a raw `Record<string, unknown>` API article — open `alpha-vantage-adpt/src/handlers/event-listener.ts:98-105` and the `mock-alpha-vantage.ts` fixture to enumerate the real article keys, then tighten `AlphaVantageArticleSchema` from `passthrough({})` to the actual fields. Leave `passthrough()` for the unmodeled remainder.

- [ ] **Step 6: Add ALL 5 tsconfig paths** — in `tsconfig.base.json`:

```json
      "@nestfolio/sec-edgar-adpt/contracts": ["services/advisory/sec-edgar-adpt/src/domain/contracts.ts"],
      "@nestfolio/fred-adpt/contracts": ["services/advisory/fred-adpt/src/domain/contracts.ts"],
      "@nestfolio/marketwatch-adpt/contracts": ["services/advisory/marketwatch-adpt/src/domain/contracts.ts"],
      "@nestfolio/yahoo-finance-adpt/contracts": ["services/advisory/yahoo-finance-adpt/src/domain/contracts.ts"],
      "@nestfolio/alpha-vantage-adpt/contracts": ["services/advisory/alpha-vantage-adpt/src/domain/contracts.ts"],
```

- [ ] **Step 7: Write the 5 contract tests** — each `test/unit/domain/contracts.test.ts` parses a representative real `fields` object (from the adapter's mock fixture) + rejects a clearly-wrong shape. Example (sec-edgar):

```typescript
import { SecFilingSchema } from '../../../src/domain/contracts';
it('SecFilingSchema parses a real filing fields object', () => {
  expect(SecFilingSchema.parse({
    cik: '0000102909', issuer: 'Vanguard', formType: '8-K', filingDate: '2026-06-10',
    accessionNumber: '0001-23-456', body: '...', source: 'sec-edgar', fetchedAt: '2026',
  }).formType).toBe('8-K');
});
```

- [ ] **Step 8: Run all 5 adapters' suites + lint + typecheck**

Run: `pnpm nx run-many -t test,lint,typecheck -p sec-edgar-adpt,fred-adpt,marketwatch-adpt,yahoo-finance-adpt,alpha-vantage-adpt --testPathPatterns contracts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/{sec-edgar-adpt,fred-adpt,marketwatch-adpt,yahoo-finance-adpt,alpha-vantage-adpt}/src/domain services/advisory/{sec-edgar-adpt,fred-adpt,marketwatch-adpt,yahoo-finance-adpt,alpha-vantage-adpt}/test/unit/domain/contracts.test.ts tsconfig.base.json
git commit --no-verify -m "feat(feed-adapters): zod producer contracts for SecFiling/FredIndicator/AlphaVantage*/MarketWatch/YahooFinance

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 11: e2e validation gate — THE #1 RISK (real decision cycle + real feed fetches)

**Files:**
- Create: `apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts`

Mirror `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts` + `…/investor/investor-contract-emission.e2e.test.ts`. The gate validates each contract against the REAL persisted row — never a fixture (the stale compliance schema is standing proof, [[event-subject-contracts]]).

**(A) Real decision-cycle block** — reuse the existing decision-cycle fixtures (`onboarded()` → the decision trigger the `/advisory` e2e uses; do NOT invent a new trigger). Drive ONE real cycle, then read + `expectContractMatch` each row:
- compliance-ctrl `ComplianceCheck` (`pk=ComplianceCheck#${tenantId}#${ccId}`, sk='ComplianceCheck') → `ComplianceCheckSchema`. (`ccId` = the RECOMMENDATION_PROPOSED eventId — query the GSI `tenantId-index` by `__typename='ComplianceCheck'`, or scan the cycle's rows.)
- decision-workflow-ctrl `DecisionPacket` (`pk=Decision#${tenantId}#${decisionId}`, sk='DecisionPacket') → `DecisionPacketSchema`; `MandateSnapshot` (`pk=MandateSnapshot#${tenantId}#${userId}`) → `MandateSnapshotSchema`.
- portfolio-engine-ctrl `AgentCompletion` (`pk=AgentCompletion#${decisionId}`, sk='AgentCompletion#portfolio-engine') → assert `AgentCompletionRow<'portfolio-engine'>`-shape; `expectContractMatch(PortfolioAgentOutputSchema, row.agentOutput, …)`.
- advisory-narrative-ctrl `AgentCompletion` (sk='AgentCompletion#advisory-narrative') → `expectContractMatch(NarrativeAgentOutputSchema, row.agentOutput, …)`.
- advisory-bff `DecisionReadModel` (`pk=Decision#${tenantId}#${decisionId}`, sk='DecisionReadModel') → `DecisionReadModelSchema`.
- investor-profile-ctrl `InvestorProfileSnapshot` + market-intelligence-ctrl `MarketSnapshot` (`pk=MarketSnapshot#${region}`) → their existing schemas (now dry; assert the parsed subject + that `region` is on the row but NOT on `parseSubject`'d output).
- **Boundaries (documented, unit-only):** `RECOMMENDATION_PROPOSED` / `DECISION_CYCLE_STARTED` / `DECISION_CYCLE_FAILED` are SF-direct, transient (no persisted row to read post-hoc) — covered by the Task-8 unit tests + asserted opportunistically via an `EventBusTrap` on the advisory bus if one is already wired in the cycle fixture. `UserConfirmation`/`UserRejection` → covered by the existing advisory-bff integration test + opportunistically if the cycle fixture confirms a decision. Note these boundaries in-file ([[no-silent-caps]]).

**(B) Feed-fetch block** — for each adapter, emit `FETCH_<SOURCE>_REQUESTED` to the adapter (bus `advisory`), then read the persisted row by exact pk + `expectContractMatch`:
- sec-edgar `SecFiling` (`pk=SecFiling#${cik}`) → `SecFilingSchema`; fred `FredIndicator` (`pk='Fred#SYSTEM'`) → `FredIndicatorSchema`; marketwatch `MarketWatchArticle` (`pk='MarketWatch#SYSTEM'`) → `MarketWatchArticleSchema`; yahoo `YahooFinanceArticle` (`pk='YahooFinance#SYSTEM'`) → `YahooFinanceArticleSchema`; alpha-vantage `AlphaVantageArticle` + `EconomicIndicator` (`pk='AlphaVantage#SYSTEM'`) → their schemas. (Strip the row envelope `pk`/`sk`/`__typename` before `expectContractMatch` since the schemas are fields-only — mirror how the ledger gate handles the `project()`-shaped rows.)
- These hit REAL external feed APIs ([[feedback-e2e-no-external-mocks]]); generous timeouts (`300_000` per `it`).

- [ ] **Step 1: Write the gate file** — create `apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts`. Header comment (mirror the execution gate's): purpose, coverage list, boundary list, exact pk/sk keys, GSI note, "DO NOT run directly outside the closing phase". Imports:

```typescript
import { createTestContext, EventBridgeClient, type TestContext } from '@nestfolio/test-support';
import { freshTenant, onboarded, poll, type FreshTenant } from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ComplianceCheckSchema } from '@nestfolio/compliance-ctrl/contracts';
import { DecisionPacketSchema, MandateSnapshotSchema } from '@nestfolio/decision-workflow-ctrl/contracts';
import { PortfolioAgentOutputSchema } from '@nestfolio/portfolio-engine-ctrl/contracts';
import { NarrativeAgentOutputSchema } from '@nestfolio/advisory-narrative-ctrl/contracts';
import { DecisionReadModelSchema } from '@nestfolio/advisory-bff/contracts';
import { InvestorProfileSnapshotSchema } from '@nestfolio/investor-profile-ctrl/contracts';
import { MarketSnapshotSchema } from '@nestfolio/market-intelligence-ctrl/contracts';
import { SecFilingSchema } from '@nestfolio/sec-edgar-adpt/contracts';
import { FredIndicatorSchema } from '@nestfolio/fred-adpt/contracts';
import { MarketWatchArticleSchema } from '@nestfolio/marketwatch-adpt/contracts';
import { YahooFinanceArticleSchema } from '@nestfolio/yahoo-finance-adpt/contracts';
import { AlphaVantageArticleSchema, EconomicIndicatorSchema } from '@nestfolio/alpha-vantage-adpt/contracts';
import { expectContractMatch } from '../helpers/contract-assert';
// ... describe/beforeAll(onboarded + drive one real cycle)/(A) decision-cycle it/(B) feed-fetch it ...
```

Fill the two `it` blocks per (A)/(B). Use `poll()` for each readback. For region/global rows, query by exact pk (no GSI). Reuse the `/advisory` cycle-trigger helper (find it in `apps/e2e-feature-tests/src` — the scenario that drives a full decision cycle).

- [ ] **Step 2: Verify the e2e project lints/typechecks** (do NOT run against dev yet)

Run: `pnpm nx run e2e-feature-tests:lint && pnpm nx run e2e-feature-tests:typecheck`
Expected: PASS — all `@nestfolio/<svc>/contracts` imports resolve (the tsconfig paths from Tasks 1-10). If any import fails, the corresponding tsconfig path is missing — add it.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts
git commit --no-verify -m "test(e2e): advisory producer-contract emission gate (real decision cycle + feed fetches)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 12: Regenerate the service cards (doc derivation)

The closing phase (`detect-doc-derivation.mjs`) flags the touched services.

- [ ] **Step 1:** Run `audit-service` for each touched advisory service: `advisory-adpt`, `compliance-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, `decision-workflow-ctrl`, `advisory-bff`, `sec-edgar-adpt`, `fred-adpt`, `marketwatch-adpt`, `yahoo-finance-adpt`, `alpha-vantage-adpt`. Accept the regenerated "Event Payload Contracts" sections. Also regen `agent-orchestrator`'s card if it has one (new `AgentCompletionRow` export). The `service-card-funding-event-type-drift` parked item is unrelated (execution funding) — do not touch.
- [ ] **Step 2: Commit**

```bash
git add services/advisory/*/CLAUDE.md libs/agent-orchestrator/CLAUDE.md
git commit --no-verify -m "docs(advisory): regen service cards for typed-subject contracts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Closing phase (driven by `/backlog-next` Step 6 — listed for completeness)

- [ ] **6.1 Doc derivation:** `node .claude/skills/backlog-next/detect-doc-derivation.mjs` → run flagged regens (Task 12 covers the service cards). Commit in this workstream.
- [ ] **6.2 Verify:** `pnpm nx affected -t test,lint,typecheck --base=origin/main` — green. (Expect the documented `agent-orchestrator` `@smithy` worktree-symlink false-FAIL — [[feedback-worktree-symlink-masks-test-failures]]; verify on real main post-merge.)
- [ ] **6.3 Detect deploy:** `node .claude/skills/backlog-next/detect-deploy-needed.mjs`. This slice is largely type-only (contracts + tests; the one runtime change is DWC `projectMarketSnapshot` reading `ctx.region` — behaviour-preserving). Deploy the services the e2e gate drives REAL: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=compliance-ctrl,decision-workflow-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,advisory-bff,sec-edgar-adpt,fred-adpt,marketwatch-adpt,yahoo-finance-adpt,alpha-vantage-adpt`. (advisory-adpt is forwarding-only — no Lambda; agent-orchestrator is a lib — redeployed transitively with its consumers.)
- [ ] **6.4 Run the gate (only the advisory scenario):** `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns advisory-contract-emission`. Must be GREEN against deployed dev. **If a contract mismatches the real row, FIX THE CONTRACT to match reality (the row is truth) — never loosen reality to fit the contract.** The real decision cycle drives real Bedrock AgentCore agents (minutes); surface the cost. If a scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing + run a confirmation pass ([[feedback-flake-means-broken]]).
- [ ] **6.5–6.8:** Ship `docs/backlog/typed-subject-contracts-advisory.md` (`status: shipped`, fill `validation_gate:` with commit SHAs + the e2e PASS line + per-service unit-test counts); `node .claude/skills/backlog-lint/lint.mjs --fix`; route to `superpowers:finishing-a-development-branch`; push `main`; git-clean the worktree + branch + session (Step 6.8 git cleanup); postflight.

---

## Out of scope (mirrors the backlog file)

- WS-2 (`cdc-publisher-typed-subjects`) + WS-3 (`consumer-parse-subject` / general `parseSubject` consumer retyping). This slice AUTHORS Advisory producer contracts + converts Advisory producer rows to `TableEntry<Subject>`; the ONE consumer co-change (DWC `projectMarketSnapshot` `ctx.region`) is the minimum required-by-producer change, not a general consumer retype.
- The enforcement capstone (`typing-convention-enforcement-skills-docs`).
- Other domains' producer contracts (Ledger + Investor + Execution shipped).
- Runtime changes to emitted CONTEXT payloads beyond what typing requires.
- Parked advisory-adjacent items: `advisory-handler-type-narrowing-debt`, `advisory-bff-decision-publisher-proposedtrade-shape-mismatch`, `an-ctrl-wrap-agent-output-vestigial`, `broker-funding-completed-normalization-drift`, `broker-ctrl-order-sf-input-contract-gap`, `ip-ctrl-snapshot-agent-fed-trigger-row`. New side-findings → `backlog-add` (file-and-continue).
- compliance-ctrl beyond the `DECISION_APPROVED`/`DECISION_BLOCKED` stale-schema fix.
- The latent empty-`proposedTrades` on the real DECISION_APPROVED→Order path (the ComplianceCheck row carries no proposedTrades; execution-ctrl reads `?? []`) — a SEPARATE finding (relates to `broker-ctrl-order-sf-input-contract-gap`); if not already filed, `backlog-add` it. This slice's contract correctly models the row as carrying no proposedTrades.

## Self-Review

**Spec coverage** (design § "Advisory (slice 4)"):
- compliance-ctrl stale-schema fix → Task 2 (`ComplianceCheck`; dead schemas deleted; real ComplianceCheck row modeled — verified proposedTrades is NOT on it). ✓
- `ProposedTrade` → zod (advisory-produced; execution imports unchanged) → Task 1 (re-exported via `/domain`, type name preserved). ✓
- decision-workflow-ctrl DECISION_PACKET_*/RECOMMENDATION_PROPOSED/MANDATE_SNAPSHOT_CREATED/DECISION_CYCLE_* + projection rows → Task 8 (CDC + SF-direct contracts; mirror rows → TableEntry; agentOutput-as-string reality documented). ✓
- investor-profile-ctrl / market-intelligence-ctrl inline rows → Tasks 3 + 4 (TableEntry; MarketSnapshot region → RegionContext with the required DWC co-change). ✓
- portfolio-engine-ctrl + advisory-narrative-ctrl Portfolio*/Narrative* contracts + shared `AgentCompletionRow<A>` generic + agentOutput typed → Tasks 5/6/7 (generic in agent-orchestrator per locked decision; per-service derived wrapper schemas per locked decision). ✓
- Tier-3 AssemblePacketEvent typed against agent schemas → Task 8 Step 7. ✓
- advisory-bff DECISION_READ_MODEL_*/USER_CONFIRMED/REJECTED → Task 9. ✓
- feed adapters SecFiling/FredIndicator/MarketWatchArticle/… → Task 10 (all GLOBAL/SubjectContext — the design's "RegionContext" expectation for feeds is corrected: none are region-scoped today; RegionContext IS exercised by MarketSnapshot in Task 4). ✓
- Home rule (producer `/contracts`; ProposedTrade cross-domain via advisory-adpt/domain) → tsconfig paths added (Tasks 1-10). ✓
- Validation against REAL emission, not fixtures → Task 11 (real decision cycle + real feed fetches). Producer unit tests + tsc → per-task + 6.2. ✓
- Depends on phase-0 taxonomy → uses `TableEntry<T,S>` / `RequestContext` / `RegionContext` / `SubjectContext`. ✓

**Placeholder scan:** every contract task has complete schema + test code. The three "OPEN the agent-service.ts / feed fixture and confirm the verbatim shape" notes (Tasks 6/7/10) are NOT silent TODOs — they specify exactly which file + which fields to confirm, give a concrete starting schema, and name the e2e gate as the final arbiter (the agent-output composite + raw feed payloads are the one place a code-read beats the summary). Task 11's two `it` bodies specify the exact triggers, keys, schemas, and boundaries against the named ledger/investor gate template. ✓

**Type consistency:** schema/type names used identically across tasks + the e2e imports — `ProposedTrade`, `ComplianceCheck`, `InvestorProfileSnapshot`, `MarketSnapshot`, `AgentCompletionRow`/`AgentFailureRow`, `PortfolioAgentOutput`, `NarrativeAgentOutput`, `DecisionPacket`, `MandateSnapshot`, `RecommendationProposed`, `DecisionCycleStarted`, `DecisionCycleFailed`, `IpSnapshotMirror`/`MarketSnapshotMirror` (DWC mirror row types), `DecisionReadModel`, `UserConfirmation`, `UserRejection`, `SecFiling`, `FredIndicator`, `MarketWatchArticle`, `YahooFinanceArticle`, `AlphaVantageArticle`, `EconomicIndicator`. The `AgentCompletionRow<A, O>` generic is consumed as `AgentCompletionRow<'portfolio-engine', PortfolioAgentOutput>` / `AgentCompletionRow<'advisory-narrative', NarrativeAgentOutput>`. ✓
