---
id: typed-subject-producer-contracts
status: shipped
rank: null
type: design
notes: "WS-1 of the typed-subject program (strategy: docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md). Every producer aggregate exports a zod subject contract (<Name>Schema + type, NO Subject suffix) that types BOTH the persisted row (TableEntry<Subject>) AND the emitted event (BusEvent<Subject>) — convention (3). Convert inline-declared row types (TaxLot, SnapshotRecord, SecFiling, DWC projection rows, IP/MI snapshot rows, PE/AN AgentCompletion/AgentFailureRow) to TableEntry<Subject>. Establish cross-domain re-export via the consuming-direction adapter's /domain (the ProposedTrade precedent) to avoid service↔service project cycles. Fix the stale compliance-ctrl DecisionApprovedSchema. Includes the advisory inter-agent handoff contracts. THE #1 RISK: validate each contract against the REAL emitted shape (actual DDB row / captured CDC subject), e2e-gated, NOT fixtures (event-subject-contracts lesson; the stale compliance schema proves it). Foundational — both WS-2 (publishers) and WS-3 (consumers) import these. Large: warrants its own brainstorm→spec, phased by domain. Folds (worktree-only items that never reached main): advisory-inter-agent-handoff-typed-contract, compliance-ctrl-stale-decision-approved-schema."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
  - services/investor/investor-ctrl/src/domain/contracts.ts
  - libs/event-processor/src/util/parse-subject.ts
out_of_scope:
  - "WS-2 (cdc-publisher-typed-subjects), WS-3 (consumer-parse-subject), and the enforcement capstone — separate ranked workstreams."
  - "The opaqueSubject helper deletion (WS-3 terminal step)."
  - "Runtime changes to emitted event context payloads beyond what typing requires (no behavioral change to context emission)."
  - "The per-domain contract IMPLEMENTATION itself — carried by the new phase-0 + 4 per-domain slice workstreams this umbrella files. This workstream produces ONLY the umbrella design spec + the decomposition (slice backlog items) + the strategy-doc home-rule correction."
spec: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
plan: null
topic_memory: []
validation_gate: "Design umbrella — done-definition was design spec + slice decomposition + strategy-doc home-rule correction (NOT implementation, per out_of_scope). (1) Umbrella design spec landed: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md (commit adce2e80 + self-review fix 28322352). (2) Strategy-doc home-rule correction landed: 2026-06-09-typed-subject-program-strategy.md now reads 'producer domain's adapter /domain' (lines 38/45), replacing the backwards 'consuming-direction' wording. (3) Decomposition filed as 5 queued slices: typed-subject-platform-context-taxonomy (rank 1, phase-0 lib taxonomy) → typed-subject-contracts-ledger (2) → -investor (3) → -execution (4) → -advisory (5); WS-2/WS-3/capstone + remaining items re-ranked 6-11. References re-verified against code: investor-ctrl/contracts.ts exports NotificationCreatedSchema+type; parse-subject.ts has parseSubject; bus.ts/table.ts show the BusEvent/TableEntry generic asymmetry the phase-0 slice fixes. Doc-layer lane on main."
---

# Typed-subject producer contracts (WS-1)

First and foundational workstream of the typed-subject program. See the strategy doc
(`docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md`) for the full picture.

## Goal

Every event any publisher or consumer touches has a **producer-owned zod contract**, exported per
the home rule, that types **both** the persisted row (`TableEntry<Subject>`) and the emitted event
(`BusEvent<Subject>`). No inline-declared row types; the context generic `S` (RequestContext) carried
on both.

## Scope

- One zod contract per producer aggregate (`<Name>Schema` + `type <Name>`, clean/event-aligned name,
  NO `Subject` suffix).
- Producer rows become `TableEntry<Subject>` — convert the inline row types (TaxLot, SnapshotRecord,
  SecFiling, the DWC projection rows, IP/MI snapshot rows, PE/AN AgentCompletion/AgentFailureRow, …).
- **Home rule:** intra-domain consumer imports producer `<svc>/contracts`; cross-domain consumer
  imports the producer's **adapter `/domain`** re-export (ProposedTrade precedent) — never
  service↔service direct (avoids the broker-ctrl↔investor-bff project cycle).
- Fix the stale `compliance-ctrl DecisionApprovedSchema` (declares `{decisionId, complianceLevel,
  approvedAt}` but the real row carries `proposedTrades` + `decisionPacketId`).
- Include the advisory inter-agent handoff payloads (the deferred Tier-3 cluster).

## Done

Every consumed/published event has a producer contract per the home rule; rows are
`TableEntry<Subject>`; stale schemas fixed; producers' tests + tsc green.

## Validation (THE #1 risk)

Each contract validated against the **REAL** emitted shape — actual DDB row / captured CDC subject —
**NOT fixtures**. The `event-subject-contracts` ship lesson: a schema co-wrong with its fixture
passed integration; only e2e caught it. The stale compliance schema is live proof.

## Opens with

A brainstorm→spec pass (this item is `type: design`): enumerate every producer aggregate + which
already export `/contracts` (investor-ctrl, investor-profile-ctrl, market-intelligence-ctrl,
ledger-ctrl, advisory-adpt ProposedTrade) vs. which need new contracts, then phase by domain.
