---
id: runtime-check-migration-judgment-tier
status: parking
type: feature
epic: runtime-operationalization
epic_role: core
notes: "P4 tier 2 (split from runtime-check-migration-completion 2026-07-06): the JUDGMENT tier of the check migration. Migrate the 4 audit-* skills (audit-service/-domain/-system/-e2e-test) + backlog-lint captured-audit + the 2 judgment gaps (core-vs-captured epic_role classification, ship-time captured promote/spin-out verdict) into skill:/judgment CheckEntries with flake_contracts. Requires building the live judge binding (the skill: executor is a stub throwing JudgeCapabilityUnavailable; makeRunProcedure({procedures}) is never populated — inject procedures[<audit-skill>] via a real headless claude -p invocation, reusing scripts/benchmark-backlog) AND an expensive-check cadence dispatcher (audit-context / schedule / epic-batch — none wired today; only commit is live). Acceptance: >=1 real audit-context execution with findings routed through intake. Needs its own brainstorming (genuinely novel infra)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime check migration — judgment tier (live judge binding + audit-* skills)

Split from `runtime-check-migration-completion` (the deterministic tier) on 2026-07-06 per that workstream's
scope decision. The deterministic tier migrated the `cmd:`/`module:` surfaces onto the live commit gate. THIS
item is the judgment tier — the genuinely-novel infra the deterministic tier deliberately excluded.

## Scope

- **The 4 audit-* skills** → `skill:` judgment CheckEntries (mirror `integration-test-completeness.yaml`):
  `audit-service`, `audit-domain`, `audit-system`, `audit-e2e-test`, each with a `flake_contract`
  (`eval_scenario` good/bad fixture pair, `allowed_flake_rate`, `calibration`, `min_confidence`).
- **backlog-lint `captured-audit` + the 2 judgment gaps** → `judgment` checks with `flake_contract`s: the
  `epicCapturedAudit` load-bearing verdict, the core-vs-captured `epic_role` classification, and the
  ship-time captured promote/spin-out verdict.
- **The live judge binding** — the `skill:` executor throws `JudgeCapabilityUnavailable` today and
  `makeRunProcedure({procedures})` is never populated by any adapter. Build the ring-2 adapter that injects
  `procedures[<audit-skill>]` with a real Skill/headless (`claude -p`) invocation and routes its findings
  through intake — reuse the proven `scripts/benchmark-backlog/` harness.
- **An expensive-check cadence dispatcher** — only `commit` has a live dispatcher; `schedule`/`epic-pre-done`/
  `ci` are stubs (`on-trigger.mjs` is an in-process Map). Wire a real dispatcher for `audit`-context /
  `expensive` checks (schedule cron and/or epic-batch and/or a CI entrypoint).
- **>=1 real audit execution** routed through intake — the binding acceptance bar (demonstrated, not asserted).

## Sequencing

Follows the deterministic tier (`runtime-check-migration-completion`) — the registry conventions + the
`*-core.mjs` wrapper pattern land there first. Needs its own brainstorming (novel adapter + cadence design).
