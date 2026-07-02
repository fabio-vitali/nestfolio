---
id: runtime-check-goldengates-ci
status: parking
type: infra
epic: runtime-operationalization
epic_role: core
notes: "Wire the existing tools/check-*.test.mjs fixture golden gates (good→0 findings, bad→≥1) + runtime/eval scenarios into nx/CI — today they have no discoverable nx target or CI wiring and never run automatically."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
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
