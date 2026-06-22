---
id: backlog-next-epic-member-subagent-isolation
status: parking
type: tooling
notes: "Tier-2 context fix for /backlog-next-epic --auto: run each epic member as a subagent so per-member investigation/edits/test-output stay out of the orchestrator's context; orchestrator keeps only compact ship-summaries. Tier-1 (per-member checkpoint+clear) already shipped. Standalone parking enhancement — NOT an audit finding; carved back out of the backlog-skills-hardening epic on 2026-06-22 (the re-homed seam-prose residuals F-26/27/28/4/10 moved to orchestrator-worker-seam-prose). Promote when epics routinely exceed ~3-4 members."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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

## Seam-residual prose gaps — CARVED OUT 2026-06-22

The 2026-06-22 audit re-homed four prose-clarity residuals on the same seam (F-26, F-27, F-28, and
F-4/F-10's Tier-1 prose residual) onto this item. They were **split back out** on 2026-06-22 into the
dedicated core member **`orchestrator-worker-seam-prose`** so the cheap, audit-required prose fixes
could ship inside the `backlog-skills-hardening` epic while this Tier-2 structural refactor stays
parked. Per CLAUDE.md atomicity (one item = one closure verdict): the residuals are audit findings
load-bearing for the epic `done_when`; this Tier-2 refactor is a non-audit enhancement orthogonal to
it. See `orchestrator-worker-seam-prose` for the residual fixes.
