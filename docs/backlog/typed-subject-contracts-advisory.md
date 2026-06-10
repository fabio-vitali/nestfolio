---
id: typed-subject-contracts-advisory
status: shipped
rank: 5
type: refactor
notes: "Advisory domain slice (slice 4) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Advisory (slice 4)'). RICHEST slice — exercises RegionContext (MarketSnapshot), the bare-base global (SecFiling), the stale-compliance fix, and the Tier-3 inter-agent handoff cluster. Folds the dropped worktree-only items advisory-inter-agent-handoff-typed-contract + compliance-ctrl-stale-decision-approved-schema. Work: compliance-ctrl stale-schema fix (DecisionApprovedSchema declares {decisionId, complianceLevel, approvedAt} but the real ComplianceCheck CDC row carries {decisionId, decisionPacketId, authorityLevel, taskToken, mandateSnapshot, result, violations}) — author a PRODUCER contract for the real DECISION_APPROVED subject + reconcile the stale schema; convert the ProposedTrade plain interface (advisory-adpt/domain) to zod HERE (advisory-produced, nests in DecisionApproved as proposedTrades[]; execution-ctrl imports it cross-domain unchanged). decision-workflow-ctrl: DECISION_PACKET_CREATED/UPDATED, RECOMMENDATION_PROPOSED, MANDATE_SNAPSHOT_CREATED, DECISION_CYCLE_STARTED/FAILED contracts; convert DWC projection rows InvestorProfileSnapshotProjectionRow + MarketSnapshotProjectionRow (domain/models.ts) to TableEntry<Subject>. investor-profile-ctrl / market-intelligence-ctrl: convert inline rows InvestorProfileSnapshotRow (RequestContext) + MarketSnapshotRow (RegionContext — drop region). portfolio-engine-ctrl + advisory-narrative-ctrl: Portfolio*/Narrative* contracts; convert AgentCompletionRow/AgentFailureRow (structural dups differing only by agentName literal → a shared AgentCompletionRow<A extends string> generic, location TBD in this slice); type agentOutput against agents/schemas.ts (PortfolioConstructionSchema, ExplainabilitySchema, GoalInterpretationSchema, RiskEvaluationSchema, MarketAnalysisOutputSchema), removing Record<string,unknown> erasure. Tier-3: AssemblePacketEvent (assemble-packet.ts) typed against the agent schemas instead of Record<string,unknown>|null. advisory-bff: DECISION_READ_MODEL_CREATED/UPDATED, USER_CONFIRMED/REJECTED contracts. Feed adapters (sec-edgar/alpha-vantage/fred/marketwatch/yahoo-finance): convert plain-interface feed payloads (SecFiling, FredIndicator, MarketWatchArticle) to zod — mostly global (bare base) / RegionContext. Depends on phase-0 (typed-subject-platform-context-taxonomy). Validation: producer unit tests + tsc green + scoped e2e against REAL emissions (the stale compliance schema is proof fixtures hide drift — [[event-subject-contracts]]). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "WS-2 (cdc-publisher-typed-subjects) and WS-3 (consumer-parse-subject): separate program workstreams. This slice only AUTHORS/extends Advisory producer contracts + converts Advisory inline rows to TableEntry<Subject>; it does NOT retype CDC publishers or consumer parseSubject seams (consumers keep reading these events however they do today)."
  - "Enforcement capstone (typing-convention-enforcement-skills-docs): codifying the conventions into create-*/audit-* skills + arch docs + any lint script is a separate queued item, not this slice."
  - "Other domains' producer contracts: ledger + investor + execution slices already shipped (2026-06-09/10). Advisory is the final slice 4."
  - "Runtime changes to emitted CONTEXT payloads beyond what typing requires (subject = business aggregate only; identity/partition metainfo stays in context S). No behavioural change to what fields are emitted at runtime."
  - "Already-filed side-findings that touch advisory-adjacent code but are their own items: broker-funding-completed-normalization-drift (rank 6), broker-ctrl-order-sf-input-contract-gap (LATER), advisory-handler-type-narrowing-debt (LATER), advisory-bff-decision-publisher-proposedtrade-shape-mismatch (LATER). New side-findings get file-and-continue via backlog-add."
  - "compliance-ctrl beyond the DECISION_APPROVED stale-schema fix: only the one drifted producer contract + its reconciliation is in scope; broader compliance-ctrl refactors are not."
spec: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
plan: docs/superpowers/plans/2026-06-10-typed-subject-contracts-advisory.md
topic_memory: []
validation_gate: "SHIPPED 2026-06-10 (branch worktree-typed-subject-contracts-advisory, 18 commits b943f76b..36aa4674). 11 plan tasks, each implementer + 2-stage review (spec + code-quality). Producer zod contracts authored/corrected across the whole advisory domain: advisory-adpt ProposedTrade interface→zod (re-exported via /domain, execution-ctrl import unchanged); compliance-ctrl ComplianceCheck (replaces dead+wrong DecisionApproved/BlockedSchema; the real ComplianceCheck row, value-mapped on result→DECISION_APPROVED/BLOCKED); investor-profile-ctrl + market-intelligence-ctrl inline rows→TableEntry<Subject>, MarketSnapshot region→RegionContext (+ required DWC ctx.region co-change); shared AgentCompletionRow<A,O>/AgentFailureRow<A> generic + key helpers moved to libs/agent-orchestrator (locked decision); portfolio-engine-ctrl PortfolioAgentOutput + advisory-narrative-ctrl NarrativeAgentOutput composite wrapper schemas (locked decision); decision-workflow-ctrl 5 contracts (3 CDC + 3 SF-direct), mirror rows→TableEntry, mandate-projector parseSubject, AssemblePacketEvent 4 agent-output fields typed Partial<ProducerType>|null; advisory-bff DecisionReadModel/UserConfirmation/UserRejection; 5 feed adapters SecFiling/FredIndicator/AlphaVantage(+EconomicIndicator)/MarketWatch/YahooFinance (all global SubjectContext). 13 service cards regenerated. Validation: nx affected lint+typecheck GREEN (49 projects); nx affected test green except the documented agent-orchestrator @smithy worktree-symlink false-FAIL (invoke-agentcore suite-load; all 127 tests pass — verify on main post-merge, [[feedback-worktree-symlink-masks-test-failures]]). THE #1-RISK GATE: apps/e2e-feature-tests/src/advisory/advisory-contract-emission.e2e.test.ts (real decision cycle via withLiveDecision through real Bedrock PE+AN agents + compliance + advisory-bff, + 5 real external feed-API fetches) — 7/7 PASS against deployed dev (run 4, gate4 log, 152s). The gate (validating contracts vs REAL emission, NOT fixtures — [[event-subject-contracts]]) found+fixed 3 REAL pre-existing bugs + 1 latent consumer bug that all unit tests + typechecks missed (co-wrong fixtures): (1) InvestorProfileSnapshotSchema declared a FLAT agentOutput but the IP agent emits a COMPOSITE {decisionId, goals:GoalInterpretation, risk:RiskEvaluation, metadata} — corrected + 4 co-wrong fixture files fixed (e342fb86); cascaded into the latent AssemblePacket always-MODERATE bug (read investorProfile?.riskCategory at a wrong top-level path → fixed to .risk?.riskCategory, user-approved behavior fix); (2) sec-edgar fetchCikFilings modeled the SEC submissions API response wrong (parallel arrays under filings.recent) → threw undefined.filings for all CIKs, 0 filings — fixed + guarded + deployed (e730caee); (3) DecisionReadModel rejectionReason was null on the real row but schema declared .optional() not .nullable() — fixed (36aa4674). Plus jest moduleNameMapper +12 advisory /contracts maps (gate couldn't load, 42b97064) + gate sec-edgar query robustness (3-CIK, SEC sinceDate makes per-CIK pk date-dependent). Deployed sec-edgar-adpt + decision-workflow-ctrl to dev (deploy.sh exit 0). Per-service producer unit tests green. 3 side-findings filed to parking (DWC sfn-callback subject.reason/blockReason consumer drift; DWC tsconfig.spec.json 10 pre-existing tsc errors; e2e jest moduleNameMapper auto-derive tooling improvement)."
---

# Typed-subject contracts — Advisory (slice 4)

Fourth and richest per-domain slice of the `typed-subject-producer-contracts` umbrella — surfaced
last by design because it exercises every hard case. See the design spec (`§ Advisory (slice 4)`).

## Goal

Every Advisory-domain producer aggregate has a producer-owned zod contract typing both the row
(`TableEntry<Subject>` / `TableEntry<Subject, RegionContext>` / global bare-base) and the event
(`BusEvent<Subject>`), validated against the real emitted shape.

## Scope

- **compliance-ctrl** — the stale-schema fix. `DecisionApprovedSchema` (`domain/schemas.ts`) declares
  `{decisionId, complianceLevel, approvedAt}` but the real CDC `ComplianceCheck` row
  (`handlers/event-listener.ts`) carries `{decisionId, decisionPacketId, authorityLevel, taskToken,
  mandateSnapshot, result, violations, …}`. Author a **producer** contract for the real
  `DECISION_APPROVED` subject and reconcile/replace the stale (consumer-side) schema.
- **`ProposedTrade`** — convert the plain `interface` (`advisory-adpt/domain`) to zod **here**
  (advisory-produced; nests in the DecisionApproved subject as `proposedTrades[]`); `execution-ctrl`
  imports it cross-domain unchanged.
- **decision-workflow-ctrl** — `DECISION_PACKET_CREATED/UPDATED`, `RECOMMENDATION_PROPOSED`,
  `MANDATE_SNAPSHOT_CREATED`, `DECISION_CYCLE_STARTED/FAILED` contracts; convert the projection rows
  `InvestorProfileSnapshotProjectionRow` + `MarketSnapshotProjectionRow` (`domain/models.ts`) to
  `TableEntry<Subject>`.
- **investor-profile-ctrl / market-intelligence-ctrl** — convert inline rows
  `InvestorProfileSnapshotRow` (`RequestContext`) + `MarketSnapshotRow` (`RegionContext` — drop
  `region`).
- **portfolio-engine-ctrl + advisory-narrative-ctrl** — `Portfolio*` / `Narrative*` contracts;
  collapse `AgentCompletionRow`/`AgentFailureRow` into a shared `AgentCompletionRow<A extends string>`
  generic (location decided in this slice); type `agentOutput` against `agents/schemas.ts`.
- **Tier-3 inter-agent handoff** — `AssemblePacketEvent` (`assemble-packet.ts`) typed against the
  agent schemas instead of `Record<string, unknown> | null`.
- **advisory-bff** — `DECISION_READ_MODEL_CREATED/UPDATED`, `USER_CONFIRMED/REJECTED` contracts.
- **feed adapters** (sec-edgar / alpha-vantage / fred / marketwatch / yahoo-finance) — convert the
  plain-`interface` feed payloads (`SecFiling`, `FredIndicator`, `MarketWatchArticle`, …) to zod;
  mostly global (bare base) / `RegionContext`.

## Done

Every Advisory event a publisher/consumer touches has a producer contract; rows are
`TableEntry<Subject>`; the stale compliance schema is fixed; `ProposedTrade` is zod; producers' unit
tests + `tsc` green.

## Validation (THE #1 risk)

Scoped e2e against deployed dev validates each contract against the **REAL** emitted shape — the
stale compliance schema is standing proof fixtures hide drift ([[event-subject-contracts]]). Producer
unit tests + `tsc` green.

## Deps

Phase-0 (`typed-subject-platform-context-taxonomy`) — needs `RegionContext` + the bare-base global
context + the constrained `TableEntry<Subject>`.
