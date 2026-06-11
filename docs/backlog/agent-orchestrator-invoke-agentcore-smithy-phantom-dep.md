---
id: agent-orchestrator-invoke-agentcore-smithy-phantom-dep
status: parking
type: bug
notes: "Pre-existing repo-wide test failure surfaced 2026-06-11 by the advisory-agent-event-contract-coverage Task-10 nx-affected gate (agent-orchestrator was affected via that workstream's agent-completion-row.ts change). libs/agent-orchestrator/test/invoke-agentcore.test.ts:7 imports `sdkStreamMixin` from `@smithy/util-stream`, which is a PHANTOM (undeclared) dependency: `require.resolve('@smithy/util-stream')` is MODULE_NOT_FOUND from BOTH the worktree AND the main repo-root node_modules — i.e. it fails on `main`, not a worktree artifact. ts-jest fails the whole suite to compile (TS2307), so `nx test agent-orchestrator` is red whenever agent-orchestrator is affected (masked until now by nx caching / absent CI — ci-pipeline-bring-up unshipped). NOT caused by + unrelated to the typed-subject workstream (which only touched agent-completion-row.{ts,test.ts} + index.ts, all green: 9/9). The src import path is fine — @smithy/util-stream is used ONLY in this TEST file, so runtime/deploy bundles are unaffected. Fix options: (a) add `@smithy/util-stream` to libs/agent-orchestrator devDependencies + pnpm install (lockfile change — frozen-lockfile reinstall + ripple risk per the pnpm-install-after-lockfile-change rule), or (b) replace the sdkStreamMixin usage with a hand-rolled stream stub so the test declares no phantom dep. Verify the fix resolves on real main, not just the worktree (worktree-symlink-masks-test-failures). Promote when stabilising the agent-orchestrator unit suite or as part of ci-pipeline-bring-up (so CI doesn't go red on the first agent-orchestrator-affected run)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# agent-orchestrator invoke-agentcore.test.ts phantom `@smithy/util-stream` dep

`libs/agent-orchestrator/test/invoke-agentcore.test.ts` imports `sdkStreamMixin` from
`@smithy/util-stream`, an **undeclared (phantom) dependency**. Under pnpm's strict
`node_modules`, the package is not resolvable at the top level — `require.resolve` returns
`MODULE_NOT_FOUND` from **both** the worktree and the main repo root — so `ts-jest` fails the
suite to compile (`TS2307`) and `nx test agent-orchestrator` goes red.

## Why it surfaced now

The `advisory-agent-event-contract-coverage` workstream added the
`AgentCompletionRowSchema`/`AgentFailureRowSchema` generators to
`libs/agent-orchestrator/src/agent-completion-row.ts`, which made `agent-orchestrator` an
**affected** project for its Task-10 `nx affected -t build,lint,test` gate. That gate ran the
full `agent-orchestrator:test` (not just the scoped `agent-completion-row` file the workstream's
own validation ran), exposing the pre-existing failure. The workstream's own changes are green
(9/9 on `agent-completion-row.test.ts`); the failure is in an untouched file.

## Impact

- `nx test agent-orchestrator` is red whenever agent-orchestrator is affected. Masked until now
  by nx caching + the absence of a green CI run (`ci-pipeline-bring-up` unshipped). Will block the
  first agent-orchestrator-affected CI run.
- **No runtime/deploy impact:** `@smithy/util-stream` is imported only in the test file, never in
  `src/`, so Lambda bundles are unaffected.

## Fix options

1. Declare `@smithy/util-stream` in `libs/agent-orchestrator/package.json` devDependencies +
   `pnpm install` (lockfile change — re-run with `--frozen-lockfile` and watch for ripple).
2. Drop the `sdkStreamMixin` import and hand-roll a minimal stream stub in the test so it declares
   no phantom dep.

Verify the chosen fix resolves on **real main**, not just the worktree.
