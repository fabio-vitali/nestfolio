---
id: jest-worker-scratch-leak-on-force-exit
status: dropped
type: bug
rank: null
notes: "DROPPED 2026-05-21 — premise obsolete. The repo-root scratch leak was already root-caused on 2026-05-20 (commit 546094c7) as a ctx_execute MCP-sandbox artifact (TMPDIR=$cwd), not a forceExit bug. No code change warranted."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Jest worker scratch leak — DROPPED (premise obsolete)

**Dropped 2026-05-21** during `/backlog-next` adoption. The investigation that
would justify this workstream had already been completed five days earlier, and
its conclusion contradicts this file's original "smoking gun".

## Real root cause (settled 2026-05-20)

Commit `546094c7` — `revert(tooling): remove safe-tmpdir.cjs preload + leak-safety
gitignore patterns` — records a finished root-cause investigation:

> the leaks observed in dev sessions were caused by an MCP sandbox tool
> (context-mode's `ctx_execute`) setting `TMPDIR=$cwd`, **NOT by anything in
> normal terminal use**. With a stock macOS TMPDIR (`/var/folders/.../T/`),
> nx + jest write their caches to the user temp dir as designed and the repo
> root stays clean.

That commit deliberately reverted the protective machinery (`safe-tmpdir.cjs`,
`.npmrc`, leak-safety `.gitignore` patterns) from `19111b72` + `c2f8b1f6`
because the machinery was treating a symptom of a tooling quirk that does not
exist in normal terminal use. The operational resolution is recorded in memory
`feedback_ctx_execute_tmpdir_leak.md`: **run cache-writing commands (nx/jest/CDK)
via Bash, never `ctx_execute`** — `ctx_execute` is read-only-processing only.

This file was written 2026-05-15 — *before* that investigation — and promoted
to QUEUED on 2026-05-21 without reconciling against it. Its "Smoking gun"
(`nx.json` `forceExit: true`) is a stale, superseded hypothesis.

## Why `forceExit` is not the cause (verified 2026-05-21)

Verification done in worktree `worktree-jest-worker-scratch-leak`, all via Bash
(stock TMPDIR):

- Full 47-project `nx run-many -t test` with `forceExit: true` **removed** from
  `nx.json`: suite passed, **did not hang**, **zero scratch dirs** leaked into
  the repo root.
- The `--forceExit` jest flag only affects the *main* jest process exit. The
  "cleanup-skipping" the original file blamed on it is actually jest-runner
  force-killing *worker* processes — a separate mechanism the flag does not
  control.
- Removing `forceExit` is **net-negative**: it surfaces a "worker process has
  failed to exit gracefully" warning in 6 backend projects (`compliance-ctrl`,
  `investor-profile-ctrl`, `ledger-ctrl`, `market-intelligence-ctrl`,
  `onboarding-bff`, `portfolio-engine-ctrl`) that `--forceExit` currently
  suppresses — with no offsetting benefit, since the leak is a `ctx_execute`
  artifact regardless.
- Those 6 warnings are not genuine bugs: `compliance-ctrl` run with
  `--detectOpenHandles --runInBand` reports **zero open handles** (8 suites,
  67 tests). It is a jest worker-pool teardown timing artifact under parallel
  runs, not a leaked timer/handle in test code.

## Disposition

No repo change is warranted. The leak is real but external to the codebase
(an MCP sandbox quirk), already root-caused, and already resolved operationally.
`forceExit: true` stays in `nx.json` — removing it only adds output noise.

If repo-root scratch dirs reappear, the cause is a test run that went through
`ctx_execute` (TMPDIR=$cwd), or a stale orphan `nx`/`jest` process — not
`forceExit`. See `feedback_ctx_execute_tmpdir_leak.md`.

## Related

- Commit `546094c7` — the root-cause revert.
- Memory `feedback_ctx_execute_tmpdir_leak.md` — operational rule.
- `feedback_docs_backlog_commits_go_to_main.md` — doc-only disposition.
