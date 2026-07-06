---
id: runtime-check-goldengates-ci
status: shipped
type: infra
epic: runtime-operationalization
epic_role: core
notes: "Wire the existing tools/check-*.test.mjs fixture golden gates (good→0 findings, bad→≥1) + runtime/eval scenarios into nx/CI — today they have no discoverable nx target or CI wiring and never run automatically."
references: []
out_of_scope:
  - "Building a new CI workflow / test job — the ci-pipeline epic owns bringing the CI test pipeline green. This item only makes `tools` a first-class nx project so the EXISTING pr-deploy.yml + deploy.yml `nx run-many -t test -p $AFFECTED` steps (fed by tools/affected-projects.mjs) pick up the golden gates automatically. No workflow file is edited."
  - "The judgment-tier check evals — only DETERMINISTIC scenarios (evaluator_kind:deterministic, with good/bad fixtures) are graded by the real driver. The judgment tier + live judge binding is runtime-check-migration-judgment-tier."
  - "Extending the *.scenario.mjs schema or touching SPEC-2 landEvalScenario — ring-1 contracts are frozen (epic out_of_scope). The per-check in-scope-path knowledge the cmd: runOverFixture needs lives co-located in the driver, NOT added to the AUTO-LANDED scenario files."
  - "Authoring net-new checks or fixtures beyond wiring the existing golden gates."
  - "Retiring the now-redundant per-check tools/check-*.test.mjs golden gates (the driver also covers the deterministic ones) — keep both; consolidation is future work."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "Complex lane, worktree branch worktree-runtime-check-goldengates-ci (commits 7d8b518a adopt · b215e299 tools nx project · 3a0c4866 pipe-mask findViolations+golden gate · f89bb045 real driver · 65e91183 follow-up). (a) tools/project.json makes `tools` a first-class nx project — verified: nx graph acyclic (tools→runtime implicit, no cycle), tools/affected-projects.mjs returns `tools` on a check-module change and `runtime,tools` on a fixture change, so the EXISTING pr-deploy.yml/deploy.yml `nx run-many -t test -p $AFFECTED` steps run the golden gates in CI with no workflow edit. (b) check-pipe-mask.mjs refactored to export a pure findViolations (identical CLI behaviour) + new tools/check-pipe-mask.test.mjs golden gate; new runtime/eval/test/grade-check-scenario.real.test.mjs grades all 8 deterministic scenarios (2 module: + 6 cmd:) through the REAL gradeCheckScenario. Gate: `nx run-many -t test,lint -p runtime,tools` RC=0, 315 tests pass (full runtime suite incl. greenfield e2e + 12 tools golden-gate/CLI/unit suites + the 9-test data-driven driver). detect-deploy-needed exit 10 (all Tier-0, no deploy/e2e). Backward edge: ship-recheck clean (ship:runtime-check-goldengates-ci:gate-clean journaled); mint consideration recorded --none (filed follow-up nx-orphan-test-file-metacheck)."
closed: 2026-07-06
---

# Wire the check golden gates into nx / CI

The `tools/check-*.test.mjs` golden gates (each reads `runtime/eval/scenarios/fixtures/<check>/{good,bad}` and
asserts good→0 findings / bad→≥1) are REAL regression protection for the migrated checks — but there is no
`tools/project.json`, `tools` is absent from `nx.json`, and the `runtime` test target globs only `runtime/**`.
So they never run under `nx affected` / CI.

Wire them: add an nx target (a `tools` project, or fold the fixtures into the `runtime` eval suite) so the
golden gates run on affected PRs. Also make `runtime/eval/grade-check-scenario.mjs` runnable over the real
`*.scenario.mjs` files (today it is exercised only by a unit test with a fake fixture-runner). Small,
high-leverage quick win — orthogonal to the loop, so it can land early.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-06
- **Decision:** Promote runtime-check-goldengates-ci out of parking and work it now as a standalone member PR
- **Options:** Promote & proceed (standalone member PR) | Work a different runtime-operationalization core member | Abort — leave in parking
- **Chosen:** Promote & proceed (standalone member PR)
- **Rationale:** User-approved at the parking-status gate. Core member of runtime-operationalization whose Decision D1 mandates draining remaining members as standalone /backlog-next member PRs; the item carries no unmet trigger (a ready quick-win); the epic is a parking/tracking epic so the epic-member redirect guard does not fire. Nothing was ACTIVE, so no in-flight conflict.
- **Rejected:** Working a different member (user named this one); abort (user wants it worked).

### D2 — 2026-07-06
- **Decision:** Sub-goal (a): give the golden gates first-class nx citizenship via a dedicated `tools` project, not by folding them into the runtime eval suite
- **Options:** New `tools` nx project with its own test target | Fold tools/*.test.mjs into the runtime project test target
- **Chosen:** New `tools` nx project with its own test target
- **Rationale:** Reusability breaks the tie (CLAUDE.md Hard Constraints): a dedicated project gives tools/ its own boundary, affected-detection, and cache, and is the generalizable pattern any workspace-tooling dir can adopt. Folding into runtime would couple the runtime library's test command to tools/ files and overload runtime's inputs — domain-conflating and less reusable. Blast radius is additive/workspace-local: no shared-lib export or event contract touched, no graph cycle (tools implicit-deps runtime, not vice-versa).
- **Rejected:** Fold-into-runtime: faster but conflates two projects and is the less reusable option.

### D3 — 2026-07-06
- **Decision:** Sub-goal (b) scope: build the FULL real data-driven driver grading all 8 deterministic scenarios through the real gradeCheckScenario, not a partial/deferred slice
- **Options:** Full real driver (all 8 deterministic scenarios, per-check in-scope-path map) | Module-only real driver, defer cmd: to a follow-up | Defer all of (b) to a follow-up item
- **Chosen:** Full real driver (all 8 deterministic scenarios, per-check in-scope-path map)
- **Rationale:** User-approved scope-boundary decision (--auto hard floor requires the human on out_of_scope forks). Most reusable + complete: a new scenario gets golden-gate CI coverage by adding one map line, not a new hand-written test; exercises the real grader over cmd: (findViolations import) and module: (fn over dir) scenarios; does not touch AUTO-LANDED scenarios or frozen ring-1 contracts.
- **Rejected:** Module-only/defer-all leave grade-check-scenario unexercised against the cmd: majority (the cleaner-over-blast-radius principle favors the complete driver).
