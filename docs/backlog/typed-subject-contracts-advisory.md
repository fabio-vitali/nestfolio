---
id: typed-subject-contracts-advisory
status: queued
rank: 5
type: refactor
notes: "Advisory domain slice (slice 4) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Advisory (slice 4)'). RICHEST slice — exercises RegionContext (MarketSnapshot), the bare-base global (SecFiling), the stale-compliance fix, and the Tier-3 inter-agent handoff cluster. Folds the dropped worktree-only items advisory-inter-agent-handoff-typed-contract + compliance-ctrl-stale-decision-approved-schema. Work: compliance-ctrl stale-schema fix (DecisionApprovedSchema declares {decisionId, complianceLevel, approvedAt} but the real ComplianceCheck CDC row carries {decisionId, decisionPacketId, authorityLevel, taskToken, mandateSnapshot, result, violations}) — author a PRODUCER contract for the real DECISION_APPROVED subject + reconcile the stale schema; convert the ProposedTrade plain interface (advisory-adpt/domain) to zod HERE (advisory-produced, nests in DecisionApproved as proposedTrades[]; execution-ctrl imports it cross-domain unchanged). decision-workflow-ctrl: DECISION_PACKET_CREATED/UPDATED, RECOMMENDATION_PROPOSED, MANDATE_SNAPSHOT_CREATED, DECISION_CYCLE_STARTED/FAILED contracts; convert DWC projection rows InvestorProfileSnapshotProjectionRow + MarketSnapshotProjectionRow (domain/models.ts) to TableEntry<Subject>. investor-profile-ctrl / market-intelligence-ctrl: convert inline rows InvestorProfileSnapshotRow (RequestContext) + MarketSnapshotRow (RegionContext — drop region). portfolio-engine-ctrl + advisory-narrative-ctrl: Portfolio*/Narrative* contracts; convert AgentCompletionRow/AgentFailureRow (structural dups differing only by agentName literal → a shared AgentCompletionRow<A extends string> generic, location TBD in this slice); type agentOutput against agents/schemas.ts (PortfolioConstructionSchema, ExplainabilitySchema, GoalInterpretationSchema, RiskEvaluationSchema, MarketAnalysisOutputSchema), removing Record<string,unknown> erasure. Tier-3: AssemblePacketEvent (assemble-packet.ts) typed against the agent schemas instead of Record<string,unknown>|null. advisory-bff: DECISION_READ_MODEL_CREATED/UPDATED, USER_CONFIRMED/REJECTED contracts. Feed adapters (sec-edgar/alpha-vantage/fred/marketwatch/yahoo-finance): convert plain-interface feed payloads (SecFiling, FredIndicator, MarketWatchArticle) to zod — mostly global (bare base) / RegionContext. Depends on phase-0 (typed-subject-platform-context-taxonomy). Validation: producer unit tests + tsc green + scoped e2e against REAL emissions (the stale compliance schema is proof fixtures hide drift — [[event-subject-contracts]]). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
