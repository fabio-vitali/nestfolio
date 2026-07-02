---
id: runtime-make-it-fire
status: queued
rank: 4
type: feature
epic: runtime-operationalization
epic_role: core
references: []
out_of_scope:
  - "The full operator view+executor (that is runtime-operational-surface)."
  - "Migrating the remaining checks (runtime-check-migration-completion)."
spec: docs/superpowers/specs/2026-07-03-runtime-make-it-fire-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
notes: "The thin live path that makes the runtime FIRE on one real trigger and dogfoods the capability seam — the unblocker for the whole operationalization epic."
---

# Runtime: make it fire (the thin live path)

Wire the runtime to actually run on ONE real trigger, with real (not stub) capabilities, so the seam gets
dogfooded by a real consumer — the precondition the rest of the operationalization epic depends on
(especially `runtime-operational-surface`).

Minimal scope (walking skeleton — keep it thin, prove the seam, not coverage):
- Subscribe the watch engine to a real `commit` trigger — e.g. a `pre-commit` (or Claude Code hook) that runs
  the `invariant`-context checks via `runtime/engine/lib/run-watch.mjs --on=commit` against the changed set,
  and blocks on findings (`exit 0 ≠ pass`).
- Inject a MINIMAL live capability set into `makeClaudeCodeCapabilities({…})` for that path (at least a real
  `journal`; `ask` may stay PAUSE for a pure gate). No full loop/orchestrator yet.
- Prove it end-to-end: a real out-of-content-ring violation is caught by the **runtime** path (not just the
  old `tools/check-*.mjs`) on a real commit, with a green/red result.

Design basis: `runtime/GUIDE.md` §7 (the path to live) + SPEC 3 §14. Complex lane: brainstorm → plan (inline,
MAX effort) → TDD build in a worktree → PR.
