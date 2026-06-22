---
id: worktree-missing-per-package-node-modules-symlink
status: parking
type: tooling
notes: "backlog-next(-epic) worktree setup symlinks only ROOT node_modules, not per-package libs/*/node_modules. pnpm puts a package's DIRECT deps under its own node_modules, so affected test+lint for event-processor/agent-orchestrator/cdk-constructs FALSE-REDs in a worktree (resolves on main). Surfaced + worked around in the deploy-tooling-integrity epic."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Worktree setup symlinks only root node_modules, not per-package libs/*/node_modules

## Root cause

`/backlog-next-epic` E2 (and the `backlog-next` worktree-creation path) symlink **only the
repo-root `node_modules`** into the fresh worktree:

```bash
ln -s "$MAIN/node_modules" .claude/worktrees/<name>/node_modules
```

But under pnpm's strict/isolated layout a package's **direct** dependencies live in that
package's **own** `node_modules`, not the root. On main today there are 3 such dirs:

```
libs/event-processor/node_modules
libs/agent-orchestrator/node_modules
libs/cdk-constructs/node_modules
```

A git worktree gets a fresh checkout of `libs/*/` **without** those per-package `node_modules`
(only the root is symlinked). So any affected `test`/`lint` for those 3 libs cannot resolve their
direct deps **in the worktree**, even though they resolve fine on `main`.

## Surfaced instance (the false-red that wasted a debug cycle)

During the `deploy-tooling-integrity` epic (member `cdk-bundle-staleness-deploy-integrity`), the
true-affected `test,lint` gate over 35 projects reported `agent-orchestrator:test` FAILED:

```
libs/agent-orchestrator/test/invoke-agentcore.test.ts:7
  TS2307: Cannot find module '@smithy/util-stream'
```

`@smithy/util-stream` is a **declared** dep (`libs/agent-orchestrator/package.json` `^4.5.23`,
added 2026-04-20 in `acd7b6e3`), present in the lockfile and installed at
`libs/agent-orchestrator/node_modules/@smithy/util-stream` **on main** — where
`nx test agent-orchestrator` passes **134/134, RC 0**. It failed **only in the worktree**, which
lacked `libs/agent-orchestrator/node_modules`. Worked around by manually symlinking the 3
per-package dirs into the worktree; the gate then went GREEN (35/35).

This **corrects and supersedes** the misdiagnosed, now-dropped
[[agent-orchestrator-invoke-agentcore-smithy-phantom-dep]] (which claimed a "phantom/undeclared
dep that fails on main / blocks CI" — falsified: declared since before that item was filed,
passes on main, so CI on a normal checkout is unaffected; only worktrees are).

## Fix (cheapest)

In the worktree-setup step (E2 of `backlog-next-epic`; the equivalent in `backlog-next`), after
symlinking root `node_modules`, also symlink every existing per-package `node_modules`:

```bash
for nm in $(cd "$MAIN" && find libs services -maxdepth 3 -name node_modules -type d); do
  [ -e "$WT/$nm" ] || ln -s "$MAIN/$nm" "$WT/$nm"
done
```

This mirrors main's pnpm layout so worktree affected-gates match main. Related worktree-fidelity
friction is captured in user-memory `worktree-deploy-friction` / `worktree-symlink-masks-test-failures`.

## Why parking (not queued)

Non-blocking — each worktree run can symlink the 3 dirs manually (as done here). Promote when
touching `backlog-next(-epic)` worktree setup, or fold into a worktree-fidelity theme.
