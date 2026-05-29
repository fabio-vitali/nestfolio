---
id: bff-readmodel-w3-advisory-decision-packet
status: queued
rank: 3
type: refactor
effort: xhigh
notes: "Workstream 3 of bff-read-model-materialization-redesign: decision-workflow-ctrl emits versioned DecisionPacket snapshots; advisory-bff + dashboard project them as P1; retire the advisory-bff attribute_exists sparse-item band-aid + status-fragment events; AdvisoryStatus count → P3."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Workstream 3 — advisory (versioned DecisionPacket)

> ⚠️ **EFFORT: xhigh** (`effort: xhigh` in frontmatter). Set reasoning effort to
> xhigh before executing this workstream — do not run it at the default. Why:
> producer change (decision-workflow-ctrl emits versioned snapshots) coordinated
> across **two** consumers (advisory-bff + dashboard-bff), and it touches the
> most race-prone path in the system — the sparse-item race and the
> APPROVED→AWAITING_CONFIRMATION overwrite race both live here, with multiple
> shipped bug fixes already. "Races gone by construction" needs the deep budget.

Make the decision read model a versioned P1 projection driven by an
authoritative producer, retiring the sparse-item-race band-aid.

## Scope / deliverables
- `decision-workflow-ctrl` (and/or compliance, per the producer's authority)
  stamps a `__version` on the `DecisionPacket`/`DecisionReadModel` row and emits
  full versioned snapshots.
- advisory-bff + dashboard-bff project those snapshots via `projectVersioned`
  (P1); register the typenames in `ReadModelOwnership`.
- Retire the advisory-bff `attribute_exists(pk)` UPDATE-before-CREATE band-aid
  and the per-field status-fragment events (no longer needed once a full
  versioned snapshot is emitted).
- `AdvisoryStatus` in-flight count → P3 derived from the advisory-owned decision
  rows (not `accumulate`d across trigger/resolution events).

## Done
DecisionPacket is a versioned P1 projection; the sparse-item race and the
APPROVED→AWAITING_CONFIRMATION overwrite races are gone by construction;
`event-processor:typecheck` + integration green; deploy + the advisory-flow
Playwright/e2e scenarios green.

## Rollout context
Rank 3 (see spec §"Decomposition"). See [[project_read_model_redesign]].
