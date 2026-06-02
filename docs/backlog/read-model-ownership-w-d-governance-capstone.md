---
id: read-model-ownership-w-d-governance-capstone
status: parking
type: tooling
notes: "WS-D of read-model-ownership-producer-aggregates: Tier-4 broker-ctrl ExecutionMode registration + governance capstone — upgrade drift-checker to mandatory-error gate + tools/read-model-exclusions.json for non-governed outbox/carrier rows; extend canonical doc §9 to producer surface; update CLAUDE.md/skill pointers. Makes the model fully enforced across all services."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "GitHub-workflow wiring of the gate (stays with ci-pipeline-bring-up — CI has never produced a green run; WS-D ships the gate as a local-runnable nx lint target only)."
validation_gate: null
---

# WS-D — Tier-4 + governance capstone

Workstream D of `read-model-ownership-producer-aggregates` (design § "WS-D").

Promote after WS-C (`read-model-ownership-w-c-consumer-conversions`) ships — the
gate can only be made mandatory once every governed row is registered.

- broker-ctrl `ExecutionMode`: register `CommandOwned` (`record()` single-field
  cache); add `__version` only if a P1 consumer of the mode cache is introduced.
- Upgrade `tools/check-read-model-drift.mjs` to **mandatory-error**: every
  intent-written typename must be either registered in a `ReadModelOwnership`
  augmentation OR listed in a committed `tools/read-model-exclusions.json` (the
  verified non-governed outbox/carrier rows — `AgentOutput`, `AgentInvocation`,
  `BalanceEvent`, external-feed adapter caches), else ERROR. Retain R1–R4 (R4 now
  per-service scoped per WS-C).
- Extend canonical doc `docs/architecture/READ-MODEL-OWNERSHIP.md` §9 per-row
  table to the producer surface.
- Update `CLAUDE.md` router / `event-processor-patterns` / audit-skill pointers if
  any reference the BFF-only scope.

Validation gate: `pnpm nx run event-processor:read-model-drift` green as a
**mandatory** gate across all services; `backlog-lint` 8/8.

See [[project_read_model_redesign]].
