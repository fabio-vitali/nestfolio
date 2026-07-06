---
id: nx-orphan-test-file-metacheck
status: parking
type: tooling
epic: runtime-operationalization
epic_role: captured
notes: "No meta-check ensures every *.test.mjs/.test.ts is covered by an nx test target, so a test file with no owning nx project silently never runs under affected/CI (the tools/check-*.test.mjs gap fixed by runtime-check-goldengates-ci)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Meta-check: every test file must be covered by an nx test target (no orphaned tests)

Backward-edge mint consideration from `runtime-check-goldengates-ci` (2026-07-06), recorded as
file-as-follow-up (that item's `out_of_scope:` excludes authoring net-new checks).

**The gap.** A `*.test.mjs` (or `*.test.ts`) whose file is not matched by *any* nx project's `test`
target — because its directory has no `project.json`, or the project's test command globs a narrower
set — is invisible to `nx affected` / `tools/affected-projects.mjs`, so it **never runs in CI** and
its assertions provide **zero** protection. The failure is silent: the tests pass locally when run
by hand and look like coverage, but nothing runs them automatically.

**Concrete instance (now fixed).** The 10+ `tools/check-*.test.mjs` golden gates existed for months
with no `tools/project.json` and were absent from every nx test glob (the `runtime` test target
globs only `runtime/**`), so they never ran under affected/CI. `runtime-check-goldengates-ci` fixed
*that* directory by making `tools` a first-class nx project. The **root cause is general**: any
future tooling/test directory added without a `project.json` (or not matched by an existing
project's `test` command) reintroduces the same silent hole.

**Proposed guard (mechanizable, deterministic).** A `cmd:` meta-check that:
1. enumerates repo `**/*.test.mjs` and `**/*.test.ts` (excluding `node_modules`, `dist`, worktrees);
2. loads the nx graph and, for each project with a `test` target, resolves the set of files that
   target actually runs (expand the `node --test` glob / read the jest `testMatch`/`roots`);
3. reports a `gap` finding for any test file covered by **no** project's `test` target.

Needs an `eval_scenario` (a fixture test file outside any target ⇒ flagged; all-covered ⇒ passes) +
a golden gate — and, once it exists, it should itself be discovered by the `tools` project (or
wherever check tests live), closing the loop.

**Distinct from** `[[runtime-invariant-safety-metacheck]]`, which guards that every active
`[invariant]` CheckEntry is *clean on a clean tree* — a different property (registry cleanliness,
not test-file→nx-target coverage). Both are registry/enforcement-hardening meta-checks captured
under `runtime-operationalization`.
