---
id: runtime-make-it-fire
status: shipped
type: feature
epic: runtime-operationalization
epic_role: core
references: []
out_of_scope:
  - "The full operator view+executor (that is runtime-operational-surface)."
  - "Migrating the remaining checks (runtime-check-migration-completion)."
  - "Remediating the pre-existing source debt the gate surfaced (gate-surfaced-source-debt)."
spec: docs/superpowers/specs/2026-07-03-runtime-gate-diff-scoping-design.md
plan: docs/superpowers/plans/2026-07-03-runtime-gate-diff-scoping.md
topic_memory: [project_runtime_realization.md]
validation_gate: "runtime suite 187/187 green (node --test); stagedFiles threaded runWatch→runCheck→resolveEvaluator (cmd env + eslint file-args) + text-scan staged mode + zero-arg backlog-id adapter, all unit-tested; smoke RED (staged `as any` → 1 finding, exit 1, no debt leakage) + GREEN (clean staged set → exit 0); gate dogfooded — greenlit its own wiring commit 55d9e7de under the live pre-commit hook."
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

## Shipped (2026-07-03)

T1 (the `pre-commit-gate.mjs` core + fail-closed CLI) shipped earlier (862230ca). Wiring it live (T2)
against the **real** content ring exposed that the gate blocked on **whole-tree debt** — 6 findings on every
commit, incl. a crashing check — because the spec's "scoped to the staged files" was unimplemented at both
the selection layer (invariants ride unconditionally — frozen §6/§11) and the scan layer (cmd/eslint tools
scan the whole tree). Rather than band-aid, this pivoted to a proper **diff-scoping** design (own spec + plan,
approved): thread a distinct concrete `stagedFiles` param into each evaluator's native channel
(cmd → `RUNTIME_STAGED_PATHS` env + a staged mode in the shared `text-scan.mjs`; eslint → staged∩scope file
args; module → whole-scope), narrowing **attribution** not **selection**, so the frozen invariant floor is
untouched. Checks split into **source-drift** (diff-scoped) vs **repo-integrity** (whole-scope). Also fixed the
mis-bound `backlog-id-matches-filename` check (zero-arg crash) via a runtime-owned adapter, and wired the gate
into `verify-structure.sh` before the services-only early-exit. The gate now fires diff-scoped on every commit
and greenlit its own wiring commit. Pre-existing debt the gate surfaced was filed separately
(`gate-surfaced-source-debt`, `no-agent-result-fallback-check-overbroad`); a full-TypeScript port of the
runtime was filed as a captured epic member (`runtime-typescript-port`).
