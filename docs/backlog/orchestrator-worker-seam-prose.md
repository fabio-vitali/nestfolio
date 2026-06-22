---
id: orchestrator-worker-seam-prose
status: active
type: tooling
notes: "Seam-clarity prose residuals on the /backlog-next-epic <-> /backlog-next drive (audit cluster 5: F-26, F-27, F-28, F-4-residual, F-10). Carved out of backlog-next-epic-member-subagent-isolation on 2026-06-22 so the cheap audit-required prose fixes ship now while the (non-audit, explicitly-deferred) Tier-2 subagent-dispatch refactor returns to standalone parking. Atomicity split decided interactively during the epic run."
references: []
out_of_scope:
  - "The Tier-2 structural refactor (run each member as a subagent) — the deferred enhancement that F-4/F-10's STRUCTURAL fix would be; lives in standalone parking item backlog-next-epic-member-subagent-isolation. Here we only do F-4/F-10's Tier-1 PROSE residual (unconditional /clear + extend E4.5 to the E4->E6 boundary)."
  - "F-5/F-6/F-7 floor + decision-log discipline — owned by the already-shipped auto-decision-discipline-and-merge-ownership member."
  - "Any restructuring of the seam (refuted by the audit — F-26's fix is one-line mechanism notes, NOT a rewrite)."
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-hardening
epic_role: core
---

# Orchestrator<->worker seam: prose-clarity residuals (audit cluster 5)

## Problem

The 2026-06-22 skills audit (`docs/reviews/2026-06-22-backlog-skills-audit.md`) confirmed four
prose-clarity residuals on the `/backlog-next-epic` <-> `/backlog-next` seam. They are cheap
one-line/one-paragraph clarifications to `backlog-next-epic/SKILL.md` (the orchestrator) — no
restructuring (the "two files contradict each other" framing was explicitly **refuted** by the audit).
These were originally re-homed onto the parked Tier-2 `backlog-next-epic-member-subagent-isolation`
item; split out here (2026-06-22) so the audit-required prose ships independently of the deferred
Tier-2 refactor.

## Fixes (all in `.claude/skills/backlog-next-epic/SKILL.md` unless noted)

- **F-26** — E4.2 says "Run `/backlog-next <member-id>`", but `backlog-next` is
  `disable-model-invocation: true`, so the inline-read is the *intended* mechanism (the orchestrator
  reads `backlog-next/SKILL.md` and executes it inline, applying the Epic-member-mode deltas) — the
  prose never says so, and the first `--auto` run hit a `tool_use_error` and burned a recovery cycle.
  **Fix:** one explicit clause in E4.2 naming the inline-read mechanism.
- **F-27** — E2/Resume says "re-enter the worktree as cwd" but the only tool that does so
  (`EnterWorktree`) is forbidden/unreliable in worker mode with no named substitute. **Fix:** name the
  mechanism in E2 (cwd via Bash `cd`/`git -C` into the worktree, per
  [[feedback-worktree-entry-cwd-pinned]] / [[feedback-exitworktree-fails-cwd-pinned]]).
- **F-28** — the loop handoff (worker STOP -> return to E4 -> loop-advance) is honor-system prose with
  no callable seam. **Fix:** a one-time clarity note that progress re-derives via `epic-members.mjs`
  (the seam already exists; just make it explicit).
- **F-4 / F-10 (Tier-1 prose residual only)** — make the inter-member `/clear` recommendation in E4.5
  *unconditional* in `--auto` heavy-member runs, and extend the E4.5 checkpoint prose to cover the
  heaviest boundary (the E4->E6 transition: last member + deploy + batched e2e). The STRUCTURAL fix for
  unbounded `--auto` context is Tier-2 (deferred, out of scope here).

## Why split from Tier-2

Per CLAUDE.md atomicity ("one item = one closure verdict"): these five are audit findings,
load-bearing for the epic `done_when` ("no improvised workaround on the orchestrator->worker drive").
The Tier-2 subagent-dispatch refactor is a pre-existing parked enhancement, NOT an audit finding, and
orthogonal to `done_when` — it returns to standalone parking.
