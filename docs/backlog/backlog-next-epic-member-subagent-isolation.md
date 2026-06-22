---
id: backlog-next-epic-member-subagent-isolation
status: parking
type: tooling
notes: "Tier-2 context fix for /backlog-next-epic --auto: run each epic member as a subagent so per-member investigation/edits/test-output stay out of the orchestrator's context; orchestrator keeps only compact ship-summaries. Tier-1 (per-member checkpoint+clear) already shipped."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-hardening
epic_role: core
---

# /backlog-next-epic: run each member as a subagent (orchestrator context isolation)

## Problem

`/backlog-next-epic --auto` drives `/backlog-next <member>` **inline in the orchestrator's own
conversation**. Every member's heavy work — file reads for editing, investigation greps,
Explore-agent reports, deploy logs, integration/e2e output, debug→re-run loops — accumulates in the
orchestrator's context. Over a multi-member epic this exhausts the window. Surfaced during the
`order-execution-money-path` epic run (5 members; hit ~66% context at WS-5 with two `Explore` reports
+ several large source/test files + deploy/integration logs pulled inline).

## Tier-1 mitigation (already shipped — do NOT re-file)

`/backlog-next-epic` SKILL.md E4.5 "Context checkpoint" — after each member ships + postflight, emit a
STABLE CHECKPOINT block and, in `--auto`, pause to recommend `/clear` + resume at the (provably safe)
per-member boundary. Honest constraint baked in: the agent cannot self-measure context %, so the
boundary + judgment is the trigger, not a %-threshold. This bounds context but still pays a
clear/resume round-trip per heavy member and reloads the orchestrator's own context each resume.

## Tier-2 (this item) — the structural fix

Run each member as a **subagent** (a `fork`/Task, or the worktree-aware equivalent) instead of inline:

- The member subagent does ALL the heavy lifting (investigation, edits, per-member integration,
  doc-derivation) in **its own** context and returns only a compact structured summary to the
  orchestrator: `{ member, lane, decisions[], validation_gate, commit SHAs, shipped|blocked }`.
- The orchestrator's context then grows ~linearly in small per-member summaries, not in every file
  touched — so a long epic no longer needs a clear per member.
- **Floor decisions must bubble up:** a subagent cannot run the user-facing AskUserQuestion floor
  pause itself, so the protocol is: subagent returns `needs-decision: {...}`; the orchestrator
  surfaces it to the user (E5), then re-dispatches the member subagent with the ruling. Auto-resolved
  (non-floor) decisions are decided inside the subagent and reported in its summary.
- Composes with the existing on-disk state model (run-state JSON + member frontmatter) and the
  single shared worktree/branch — the subagent commits on `feat/epic-<id>` like the inline worker.

## Cost / why parked (not trivial)

The worker skill (`/backlog-next`) is currently written to run in the main loop (`disable-model-invocation`,
"driven" by the orchestrator following its SKILL.md). Converting member execution to subagent dispatch
is a non-trivial refactor: define the member-subagent contract (summary schema + `needs-decision`
protocol), ensure the subagent can enter the shared worktree (cwd-pinned-session caveats —
[[feedback-exitworktree-fails-cwd-pinned]], [[feedback-worktree-entry-cwd-pinned]]), and keep the
batched-e2e / captured-audit / single-PR invariants. Worth it when epics routinely exceed ~3-4
members; Tier-1 holds the line until then.

## Seam-residual prose gaps (re-homed 2026-06-22 — audit cluster 5)

This item is the structural fix for the orchestrator↔worker seam. The 2026-06-22 skills audit
(`docs/reviews/2026-06-22-backlog-skills-audit.md`) surfaced four prose-clarity residuals on the SAME
seam that are cheap to fix *now* even before the Tier-2 refactor lands — fold them in here:

- **F-26** — E4.2 says "Run `/backlog-next <member-id>`", but `backlog-next` is `disable-model-invocation:true`
  so a Skill-tool call is mechanically refused; the inline-read is the *intended* design (this item's
  premise) yet the prose never says so. The run hit the `tool_use_error` and burned a recovery cycle.
  Fix: one explicit clause in E4.2 — "do NOT call the Skill tool; read `backlog-next/SKILL.md` and
  execute it inline, applying the Epic-member deltas."
- **F-27** — E2/Resume says "re-enter the worktree as cwd" but the only tool that does so
  (`EnterWorktree`) is forbidden in worker mode with no named substitute; name the mechanism in E2.
- **F-28** — the loop handoff (worker STOP → return to E4.2 → loop-advance) is honor-system prose with
  no callable seam; add a one-time clarity note (the re-derive via `epic-members.mjs` already exists).
- **F-4 / F-10** — unbounded `--auto` context (this item's Tier-2 is the structural fix); the Tier-1
  residual is to make the inter-member `/clear` recommendation *unconditional* and extend the E4.5
  checkpoint to cover the heaviest E4→E6 boundary.
