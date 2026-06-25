---
id: bef-unit-tests-leak-tmpdirs
status: active
type: tooling
notes: "benchmark-backlog unit tests (grade-golden, grade-invariants, worker, sandbox) mkdtempSync throwaway dirs but never clean them up, so TMPDIR accumulates ~hundreds of bef-* dirs across runs. Add afterEach/try-finally cleanup."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
out_of_scope:
  - "sandbox.test.mjs and structural-lint.test.mjs — they ALREADY clean up (buildSandbox cleanup() in finally; rmSync in finally respectively). The leak is only in grade-golden, grade-invariants, worker."
  - "Purging the ~99 pre-existing leaked bef-* dirs already in $TMPDIR from prior runs — that is one-off housekeeping, not part of the code change; the fix prevents FUTURE leaks (proven net-zero new dirs)."
  - "Reworking the test structure or the buildSandbox cleanup contract beyond adding the missing rmSync."
validation_gate: null
epic: backlog-eval-framework-remaining
epic_role: core
---

# benchmark-backlog: unit tests leak TMPDIR scratch dirs

The `node:test` suites under `scripts/benchmark-backlog/test/` that need a throwaway git repo or
sandbox (`grade-golden`, `grade-invariants`, `worker`, `sandbox`) create dirs via `mkdtempSync(tmpdir(),
'bef-…')` but never remove them, so each run leaks a handful and they pile up (≈200 `bef-*` dirs observed
in `$TMPDIR` during this workstream). `sandbox.test.mjs` already returns a `cleanup()` from
`buildSandbox` — the grade/worker tests should likewise wrap their temp dirs in a `try/finally` (or a
`test`/`afterEach` hook) `rmSync(dir, {recursive, force})`.

Cosmetic (no correctness impact) but untidy and slowly fills the temp partition. Related:
[[project_backlog_eval_framework]].
