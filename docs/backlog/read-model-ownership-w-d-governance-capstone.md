---
id: read-model-ownership-w-d-governance-capstone
status: queued
rank: 5
type: tooling
notes: "WS-D of read-model-ownership-producer-aggregates: Tier-4 broker-ctrl ExecutionMode registration + governance capstone — upgrade drift-checker to mandatory-error gate + tools/read-model-exclusions.json for non-governed outbox/carrier rows; wire the typecheck trip-wire into CI (folded bff-readmodel-typecheck-targets-not-in-ci); extend canonical doc §9 to producer surface; update CLAUDE.md/skill pointers. Makes the model fully enforced across all services."
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

> ⚠ **Read-model refactoring item.** Any side-finding required to call this refactoring complete must be **folded into a QUEUED read-model item, never parked in LATER** — see `CLAUDE.md` § "Backlog Discipline" (refactoring-completeness exception).


Workstream D of `read-model-ownership-producer-aggregates` (design § "WS-D").

Sequenced after WS-C (`read-model-ownership-w-c-consumer-conversions`, rank 4):
the gate can only be made mandatory once every governed row is registered.

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
- **Wire the ownership typecheck trip-wire into CI** (folded from
  `bff-readmodel-typecheck-targets-not-in-ci`): the per-service `@ts-expect-error`
  ownership type-tests are exposed as nx `typecheck` targets
  (`event-processor:typecheck`, `*-bff:typecheck`) but nothing in CI runs them
  (`nx.json` `targetDefaults` has no `typecheck`; ts-jest runs `diagnostics:false`;
  ESLint isn't type-aware). Register `typecheck` in `targetDefaults` + add
  `pnpm nx affected -t typecheck --base=origin/main` to the PR workflow, so the
  trip-wire gates mechanically, not by hand. If CI is still not green per
  `ci-pipeline-bring-up`, ship the `targetDefaults` registration + a local-runnable
  target and hand the workflow step to that workstream (per out_of_scope).
- Update `CLAUDE.md` router / `event-processor-patterns` / audit-skill pointers if
  any reference the BFF-only scope.

Validation gate: `pnpm nx run event-processor:read-model-drift` green as a
**mandatory** gate across all services; `backlog-lint` 8/8.

**Program-end consolidated e2e (2026-06-02, user direction).** Because the whole
read-model QUEUED set is ONE refactoring over overlapping read surfaces, the
expensive real-LLM e2e is NOT run per intermediate workstream (deviation from
`/backlog-next` step 6.4). WS-A–WS-C + the BFF residuals keep only cheap gates
(`test,lint` + per-service `typecheck` + `event-processor:read-model-drift` +
`test-integration` with mocked agents + the dev deploy). The involved
**advisory decision-pipeline + dashboard + ledger** real-LLM e2e scenarios run
**once, here at WS-D**, against fully-converged dev — this is part of WS-D's gate,
not optional. See [[project_read_model_redesign]] validation-cadence decision.

See [[project_read_model_redesign]].
