---
id: read-model-ownership-w-d-governance-capstone
status: shipped
rank: 6
type: tooling
notes: "WS-D of read-model-ownership-producer-aggregates: Tier-4 broker-ctrl ExecutionMode registration + governance capstone — upgrade drift-checker to mandatory-error gate + tools/read-model-exclusions.json for non-governed outbox/carrier rows; wire the typecheck trip-wire into CI (folded bff-readmodel-typecheck-targets-not-in-ci); extend canonical doc §9 to producer surface; update CLAUDE.md/skill pointers. Makes the model fully enforced across all services."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: docs/superpowers/plans/2026-06-03-read-model-ownership-w-d-governance-capstone.md
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "GitHub-workflow wiring of the gate (stays with ci-pipeline-bring-up — CI has never produced a green run; WS-D ships the gate as a local-runnable nx lint target only)."
  - "Adding __version carriage / a P1 consumer to broker-ctrl ExecutionMode — registered CommandOwned only (record() single-field cache); __version is added later iff a P1 consumer of the mode cache is introduced (design WS-D)."
  - "Fixing any newly-discovered governed P1 row that lacks a version source — folded into a NEW queued read-model item per the refactoring-completeness exception, NOT patched inside this gate-upgrade workstream (WS-D ships the gate + exclusion registry, not new producer version sources)."
validation_gate: |
  Shipped on worktree branch worktree-read-model-ownership-w-d-governance-capstone
  (12 commits, f3dc6600..e75e1c04). All gates green:
  - MANDATORY drift gate: `pnpm nx run event-processor:read-model-drift` →
    `OK (44 registered typename(s), 25 excluded, 0 drift)`, exit 0. Unregistered
    intent-factory writes are now a hard ERROR (R5) unless in
    tools/read-model-exclusions.json (R6 guards register+exclude contradiction).
  - Checker unit tests: `node --test tools/check-read-model-drift.test.mjs` → 26/26
    pass (incl. new R5/R6/exclusion-skip/parseExclusions/CLI tests).
  - typecheck + lint + test on the 4 touched projects (broker-ctrl,
    reconciliation-ctrl, investor-bff, event-processor) → all pass. typecheck now
    runs under `nx affected -t typecheck` via the nx.json targetDefault.
  - Registrations: ExecutionMode (broker-ctrl), ReconciliationResult + DriftRecord
    (reconciliation-ctrl), FeatureFlag (investor-bff, documentary) — all CommandOwned,
    each with read-model-ownership.ts + type-test + typecheck target. 25 verified
    non-governed outbox/carrier/feed-cache rows excluded.
  - Service cards regenerated (broker-ctrl, reconciliation-ctrl, investor-bff).
  - Canonical doc §9 producer-surface table + §10 mandatory-gate rewrite.
  - Skill/router pointers updated (event-processor-patterns, create-service/feature/event,
    audit-service/domain/system, CLAUDE.md).
  - No deploy: all code changes are type-only augmentations (declare module + export{},
    stripped by esbuild) → zero runtime bundle change.
  - Program-end consolidated real-LLM e2e (the deferred program gate, run once here
    against fully-converged dev): 4/4 PASS —
    advisory/first-decision (83.6s), advisory/accept-decision (150.9s),
    advisory/reconciliation-correction (142.8s), funding/fund-account (47.3s);
    globalTeardown alpacaPaperReset OK (prefix=dev). No flakes (1x, all green).
  - GitHub-workflow wiring of the gate deferred to ci-pipeline-bring-up (out_of_scope).
  This completes the read-model-ownership program: the single-writer ownership model
  is now fully enforced as a mandatory gate across all 32 services.
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
