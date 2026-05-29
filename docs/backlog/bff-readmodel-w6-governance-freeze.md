---
id: bff-readmodel-w6-governance-freeze
status: queued
rank: 6
type: tooling
notes: "Workstream 6 (governance/freeze) of bff-read-model-materialization-redesign: enforcement layers 3+4 — ownership-classification step in create-service/create-feature/create-event, testing-patterns + CLAUDE.md router pointer, and drift checks in audit-service/audit-domain/audit-system (+ CI lint). Final consolidation of updates applied incrementally as each BFF migrated."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Workstream 6 — governance / freeze (enforcement layers 3 + 4)

w0 shipped layers 1 (types) + 2 (canonical doc). This workstream lands the
remaining freeze layers so the model stays enforced and new code starts correct.
The skill/audit edits are applied incrementally as each BFF migrates (w1–w5);
this workstream is the final consolidation + the audit/CI backstop.

## Scope / deliverables
- **Layer 3 (skill guidance):** add the ownership-classification step ("who is
  the boss of this row — command-owned or projection?") to `create-service`,
  `create-feature`, `create-event`; add version-guard + stale-drop patterns to
  `testing-patterns`; add a `CLAUDE.md` router pointer to
  `docs/architecture/READ-MODEL-OWNERSHIP.md`. (`event-processor-patterns`
  already updated in w0.)
- **Layer 4 (audit backstop):** `audit-service` / `audit-domain` / `audit-system`
  flag — a `Projection` row written by `accumulate`; a typename written by **both**
  a command and an event; a `Projection` with no version guard; a schema field
  never written (structural zero). Add a CI lint where feasible.

## Done
skills carry the ownership-classification step; audits flag the four drift
classes; CI lint added; `pnpm nx affected -t test,lint` green; an `audit-system`
run is clean against the migrated BFFs.

## Rollout context
Rank 6 — the closing governance pass (see spec §"Freezing the model" layers 3+4
and §"Decomposition" step 6). See [[project_read_model_redesign]].
