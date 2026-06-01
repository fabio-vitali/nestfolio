---
id: bff-readmodel-w6-governance-freeze
status: active
rank: 6
type: tooling
notes: "Workstream 6 (governance/freeze) of bff-read-model-materialization-redesign: enforcement layers 3+4 — ownership-classification step in create-service/create-feature/create-event, testing-patterns + CLAUDE.md router pointer, and drift checks in audit-service/audit-domain/audit-system (+ local nx drift-checker target). Layer-3/4 skill+audit edits were NOT applied incrementally during w1–w5 (verified 2026-06-01: only event-processor-patterns carries the model); w6 is the full layers-3+4 build, not a thin consolidation."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "GitHub-workflow wiring of the drift-checker (deferred to ci-pipeline-bring-up — the CI pipeline has never produced a green run; w6 ships the checker as a local-runnable nx lint target only)."
  - "The numbered workstreams' (w0–w5) implementation — all shipped."
  - "Live-push transport (the deferred dashboard-live-push-* items) — rebuilt on the clean read model separately."
  - "Event sourcing on the write side — explicitly NOT adopted; system stays state-stored-aggregate + CDC-outbox."
  - "Structural-zero (schema field never written) as a STATIC checker class — kept prose-only in the audit skills; the 3 mechanical classes (accumulate-on-Projection, dual command+event writer, missing version-guard) are the scripted ones."
validation_gate: null
---

# Workstream 6 — governance / freeze (enforcement layers 3 + 4)

w0 shipped layers 1 (types) + 2 (canonical doc). This workstream lands the
remaining freeze layers so the model stays enforced and new code starts correct.

**Correction (verified 2026-06-01):** the layer-3/layer-4 skill+audit edits were
**NOT** applied incrementally during w1–w5 as the original framing assumed. Only
`event-processor-patterns` (a w0 deliverable) carries the model;
`create-service` / `create-feature` / `create-event` / `testing-patterns`,
`CLAUDE.md`, and `audit-service` / `audit-domain` / `audit-system` have zero
references to it. So w6 is the **full** layers-3+4 build, not a consolidation.

## Scope / deliverables
- **Layer 3 (skill guidance):** add the ownership-classification step ("who is
  the boss of this row — command-owned or projection?") to `create-service`,
  `create-feature`, `create-event`; add version-guard + stale-drop patterns to
  `testing-patterns`; add a `CLAUDE.md` router pointer to
  `docs/architecture/READ-MODEL-OWNERSHIP.md`. (`event-processor-patterns`
  already updated in w0.)
- **Layer 4 (audit backstop):** a runnable static **drift-checker** (nx lint
  target) flags the 3 mechanical classes — a `Projection` row written by
  `accumulate`; a typename written by **both** a command and an event; a
  `Projection` with no version guard. `audit-service` / `audit-domain` /
  `audit-system` invoke it; the 4th class (schema field never written /
  structural zero) stays prose guidance in the audit skills. The checker doubles
  as the CI lint, exposed as an nx target runnable now; GitHub-workflow wiring is
  deferred to `ci-pipeline-bring-up` (pipeline not yet green).

## Done
skills carry the ownership-classification step; `testing-patterns` carries the
version-guard + stale-drop patterns; the drift-checker nx target flags the 3
mechanical classes and is invoked by the audit skills; `CLAUDE.md` points to the
canonical doc; `pnpm nx affected -t test,lint` green; an `audit-system` run is
clean against the migrated BFFs.

## Out of scope
- GitHub-workflow wiring of the drift-checker (deferred to `ci-pipeline-bring-up`).
- w0–w5 implementation (all shipped).
- Live-push transport (deferred `dashboard-live-push-*` items).
- Event sourcing on the write side (explicitly not adopted).
- Structural-zero as a *static* checker class (kept prose-only).

## Rollout context
Rank 6 — the closing governance pass (see spec §"Freezing the model" layers 3+4
and §"Decomposition" step 6). See [[project_read_model_redesign]].
