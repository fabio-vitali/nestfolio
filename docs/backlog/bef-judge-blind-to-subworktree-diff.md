---
id: bef-judge-blind-to-subworktree-diff
status: parking
type: bug
notes: "bef judge.mjs reads the outcome diff from the sandbox ROOT, so it sees an EMPTY diff for fresh-sub-worktree scenarios (worker commits the ship on a worktree branch, sandbox-root HEAD stays on main). Harmless today (no rubricGate on such a scenario); latent if one is added. Captured under bef-deterministic-coverage-gaps for unified PR context; un-pointed back to a standalone parking orphan at that epic's close (2026-06-30) — confirmed orthogonal by the captured audit, matching the 2026-06-29 backlog-themes adjudication (no shared root cause with the other 2 riders)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# bef LLM judge is blind to sub-worktree branch diffs

`scripts/benchmark-backlog/judge.mjs` `outcomeDiff(sandboxDir)` resolves the diff the judge sees via
a fallback chain, all run with `cwd: sandboxDir` (the sandbox ROOT):

```
git diff origin/main...HEAD   // line 34 — full branch delta
git diff HEAD~1 HEAD          // line 35 — fallback: single extra commit
git diff HEAD                 // line 36 — fallback: uncommitted working tree
```

For a scenario whose worker **creates its own sub-worktree** and commits the ship there — a fresh
Complex-lane drive-to-ship (`next-lane-complex-ship`: adopt → worktree+branch → ship-on-branch), or a
fresh epic run whose orchestrator works in `.claude/worktrees/epic-<id>` — the **sandbox-root HEAD
stays on `main`**. So `origin/main...HEAD` (read from the root) is empty, `HEAD~1` doesn't exist (the
sandbox base has a single commit → the caught but stderr-leaking `fatal: ambiguous argument 'HEAD~1'`),
and `git diff HEAD` is empty too. **The judge sees an empty diff** and scores only from the prompt +
runResult, not the actual branch changes.

**Currently NON-BLOCKING** (why this is `captured`, orthogonal to the epic `done_when`): no `rubricGate`
scenario relies on a sub-worktree diff. `bne-e8-conflict-resolution` (the one heavy `rubricGate: 4`
worktree scenario) **pre-checks-out its epic branch at the sandbox root** in its `setup` hook (`git
checkout feat/epic-e8-conflict`), so `origin/main...HEAD` there IS the real branch delta. The
sub-worktree drive-to-ship scenarios (`next-lane-complex-ship`) use an **advisory** rubric (no
`rubricGate`), so their gate rests on deterministic golden + invariant teeth (deploy fired,
`branchCreated`, call-log no-self-merge, terminal) — the empty judge diff doesn't touch the verdict.

**Latent gap:** adding a `rubricGate` to a fresh-sub-worktree scenario would silently blind the judge
(it would score a non-existent diff), giving a meaningless gate. Fix options: (a) have `outcomeDiff`
detect the worker-created sub-worktree branch (`git worktree list` / `git for-each-ref` for a
`feat/*` branch) and diff THAT; or (b) document/assert the limitation so `rubricGate` is never added
to such a scenario.

Surfaced during `bef-finishing-stub-drive-to-ship` live verification (2026-06-27). Topic:
[[project_backlog_eval_framework]]. Captured under [[backlog-eval-corpus-hardening]] — re-tested at the
epic's captured audit.
