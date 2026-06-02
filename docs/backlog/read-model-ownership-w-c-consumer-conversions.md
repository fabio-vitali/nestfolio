---
id: read-model-ownership-w-c-consumer-conversions
status: queued
rank: 4
type: refactor
notes: "WS-C of read-model-ownership-producer-aggregates: convert consumer projections to projectVersioned keyed on upstream __version + register Projection<'P1'> — DWC LedgerSnapshot/MandateSnapshot/InvestorProfileSnapshot/MarketSnapshot mirrors, compliance-ctrl MandateSnapshot, dashboard-bff TimeTravelAvailability. Includes R4 per-service scoping drift-checker refinement (prereq). Documents Mandate fan-out contract."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "The mandatory-error drift-checker upgrade + exclusion registry (WS-D) — WS-C adds only the per-service R4 scoping needed to register same-typename-two-roles rows."
validation_gate: null
---

# WS-C — Consumer projectVersioned conversions

Workstream C of `read-model-ownership-producer-aggregates` (design § "WS-C").

Sequenced after WS-B (`read-model-ownership-w-b-version-carriage`, rank 3): the
consumer conversions need the upstream `__version` to exist first (`LedgerSnapshot`
excepted — its `lastEventSequence` source already exists).

Conversions (`record()`/`update()`/`project()` → `projectVersioned`, register
`Projection<'P1'>`):

- decision-workflow-ctrl `LedgerSnapshot` (version-present; no WS-B dependency, but
  it deploys DWC so it rides with the other DWC conversions here rather than the
  type-only WS-A)
- decision-workflow-ctrl mirrors: `MandateSnapshot`, `InvestorProfileSnapshot`, `MarketSnapshot`
- compliance-ctrl `MandateSnapshot`
- dashboard-bff `TimeTravelAvailability`

Prerequisite refinement: scope drift-checker **R4 per-service** (registry key
becomes `(service, typename)`) so `MarketSnapshot`/`InvestorProfileSnapshot`
(CommandOwned in the owner, P1 in DWC's mirror) don't trip the global
same-typename-conflict rule. Document the Mandate fan-out contract (investor-bff
owner; compliance-ctrl + DWC keep two independent P1 copies on one version line) in
canonical doc §9.

Validation gate: deploy dev + integration + advisory/dashboard involved e2e.

See [[project_read_model_redesign]].
