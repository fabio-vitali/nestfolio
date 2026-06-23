---
id: backlog-next-epic-member-subagent-isolation
status: shipped
closed: 2026-06-23
type: tooling
notes: "Tier-2 context fix for /backlog-next-epic --auto: run each epic member as a subagent so per-member investigation/edits/test-output stay out of the orchestrator's context; orchestrator keeps only compact ship-summaries. SUPERSEDES Tier-1 (per-member checkpoint+clear, shipped) — shipping Tier-2 REMOVES the E4.5 clear/resume pause so --auto runs unattended (toward GitHub-runner autonomy), not in addition to it. Standalone enhancement — NOT an audit finding; carved back out of the backlog-skills-hardening epic on 2026-06-22 (the re-homed seam-prose residuals F-26/27/28/4/10 moved to orchestrator-worker-seam-prose). PROMOTED 2026-06-23: trigger fired — the two most recent delivery epics ran 5 (order-execution-money-path, hit ~66% orchestrator context at WS-5) and 4 (deploy-tooling-integrity) core members, exceeding the ~3-4-member threshold that gated this enhancement."
references: []
out_of_scope:
  - "Standalone `/backlog-next` execution model — stays inline-loaded via the Skill tool; ONLY epic-MEMBER execution (driven by `/backlog-next-epic`) moves to subagent dispatch."
  - "Fully-unattended GitHub-runner harness/auth — Tier-2 defines the `needs-decision`→block/fail-the-run signal, but actually wiring `/backlog-next-epic --auto` onto a CI runner (credentials, trigger, artifact capture) is a separate downstream workstream."
  - "orchestrator-worker-seam-prose residuals (F-26/27/28/4/10) — owned by the separate `orchestrator-worker-seam-prose` member; not re-touched here."
  - "Redesign of the on-disk epic run-state JSON + member-frontmatter state model — Tier-2 composes with it as-is (subagent commits on the same `feat/epic-<id>` branch); the state model is not reworked."
spec: docs/superpowers/specs/2026-06-23-backlog-next-epic-member-subagent-isolation-design.md
plan: docs/superpowers/plans/2026-06-23-tier2-epic-member-subagent-isolation.md
topic_memory: []
validation_gate: "Tier-2 Tasks 2-8 implemented on feat/epic-member-subagent-isolation (c637ee03 fork-key, c5d269a4 member-summary, 4feb8c2f runstate clear-e8/dedup/fork_key, bdad34d5 epic-member-worker agent, 600d235f orchestrator SKILL.md E4-E9+§G-J, 72a7651e worker SKILL.md delta, 6536be57 docs). Tests GREEN: backlog-next-epic 41/41, backlog-next 40/40 (node --test). Helper-level path coverage 13/13 (exit-code routing 0/1/2/3, fork_key determinism, dedup/supersede/override, multi-fork, wx-lock). Harness spike MODE=TIER2-GO. Live end-to-end /backlog-next-epic dry-run is post-merge/user-triggered (new skills active only after merge; disable-model-invocation) -> queued as tier2-live-end-to-end-dry-run. Deferred follow-ups filed: epic-member-floor-deny-hook, remove-tier1-clear-fallback (parking)."
---

# /backlog-next-epic: run each member as a subagent (orchestrator context isolation)

## Promoted 2026-06-23 (trigger fired)

Parking trigger was the **~3-4-member threshold** — it gated this enhancement until epics routinely
grew past that size. It fired: the two most recent delivery epics ran **5** members
(`order-execution-money-path` — the run that surfaced this item, hitting ~66% orchestrator context
at WS-5) and **4** members (`deploy-tooling-integrity`), both exceeding the threshold. Promoted to `queued`, rank 1. Complex lane (skill-orchestration
refactor) — routes through `superpowers:brainstorming` to design the member-subagent contract
before any code. The "why parked / not trivial" section below now reads as the **cost/scope dossier**
for the workstream, not a reason to defer.

## Problem

`/backlog-next-epic --auto` drives `/backlog-next <member>` **inline in the orchestrator's own
conversation**. Every member's heavy work — file reads for editing, investigation greps,
Explore-agent reports, deploy logs, integration/e2e output, debug→re-run loops — accumulates in the
orchestrator's context. Over a multi-member epic this exhausts the window. Surfaced during the
`order-execution-money-path` epic run (5 members; hit ~66% context at WS-5 with two `Explore` reports
+ several large source/test files + deploy/integration logs pulled inline).

## Tier-1 mitigation — INTERIM, superseded by Tier-2 (already shipped — do NOT re-file)

`/backlog-next-epic` SKILL.md E4.5 "Context checkpoint" — after each member ships + postflight, emit a
STABLE CHECKPOINT block and, in `--auto`, pause to recommend `/clear` + resume at the (provably safe)
per-member boundary. Honest constraint baked in: the agent cannot self-measure context %, so the
boundary + judgment is the trigger, not a %-threshold. This bounds context but still pays a
clear/resume round-trip per heavy member and reloads the orchestrator's own context each resume.

**This is a stopgap, not a layer to keep.** The per-member `/clear`+resume pause is precisely the
`--auto` interruption Tier-2 exists to eliminate — so Tier-2 **replaces** Tier-1, it does not stack on
top of it. See the explicit replacement note in the Tier-2 section.

## Tier-2 (this item) — the structural fix that REPLACES Tier-1

**Shipping Tier-2 removes Tier-1, it does not add to it.** When member execution moves into a subagent,
the orchestrator's context stops growing with each member's heavy work, so the E4.5 per-member
`/clear`+resume checkpoint loses its reason to exist — and it is actively harmful to keep: that pause
is a *user-facing interruption* of `--auto`. The whole point of `--auto` is "launch the epic, walk
away," and the longer-term target is running it **unattended on GitHub runners** with no human in the
loop. A mechanism that stops every heavy member to ask the user to `/clear` and resume defeats both.
So part of landing Tier-2 is **deleting the E4.5 checkpoint/clear/resume prose** (and any `--auto`
pause that depends on it) — Tier-1 was only ever the stopgap that held the line until this lands.

Run each member as a **subagent** (a `fork`/Task, or the worktree-aware equivalent) instead of inline:

- The member subagent does ALL the heavy lifting (investigation, edits, per-member integration,
  doc-derivation) in **its own** context and returns only a compact structured summary to the
  orchestrator: `{ member, lane, decisions[], validation_gate, commit SHAs, shipped|blocked }`.
- The orchestrator's context then grows ~linearly in small per-member summaries, not in every file
  touched — so a long epic no longer needs a clear per member.
- **Floor decisions must bubble up (the only remaining pause):** auto-resolved (non-floor) decisions
  are decided inside the subagent and reported in its summary — those never interrupt `--auto`. The
  hard floor (irreversible/outward-facing: real-money, staging/prod, force-push, destructive deletes)
  is a *deliberate safety gate*, not a context-management interruption like Tier-1's clear/resume, so
  it stays. A subagent cannot run the user-facing AskUserQuestion itself, so the protocol is: subagent
  returns `needs-decision: {...}`; the orchestrator surfaces it (E5), then re-dispatches the member
  subagent with the ruling. Under fully-unattended operation (GitHub runners), this same `needs-decision`
  signal becomes a block/fail-the-run rather than an interactive prompt — the floor never *silently*
  proceeds, but it also never blocks waiting on a human who isn't there.
- Composes with the existing on-disk state model (run-state JSON + member frontmatter) and the
  single shared worktree/branch — the subagent commits on `feat/epic-<id>` like the inline worker.

## Cost / why parked (not trivial)

Today the orchestrator drives the worker (`/backlog-next`) **inline in its own context**: `backlog-next`
is intentionally **NOT** `disable-model-invocation` (that key was removed on purpose), so the
orchestrator invokes it via the **Skill tool**, which loads the worker's SKILL.md inline rather than
spawning a detached subagent. That inline-load *is* the current execution model — and it is exactly why
every member's heavy work piles up in the orchestrator's window (the growth this item exists to fix).
Converting member execution to subagent dispatch is a non-trivial refactor: define the member-subagent
contract (summary schema + `needs-decision` protocol), ensure the subagent can enter the shared worktree
(cwd-pinned-session caveats — [[feedback-exitworktree-fails-cwd-pinned]],
[[feedback-worktree-entry-cwd-pinned]]), keep the batched-e2e / captured-audit / single-PR invariants,
and delete the now-redundant Tier-1 E4.5 checkpoint. Worth it when epics routinely exceed ~3-4 members;
Tier-1 holds the line until then.

## Seam-residual prose gaps — CARVED OUT 2026-06-22

The 2026-06-22 audit re-homed four prose-clarity residuals on the same seam (F-26, F-27, F-28, and
F-4/F-10's Tier-1 prose residual) onto this item. They were **split back out** on 2026-06-22 into the
dedicated core member **`orchestrator-worker-seam-prose`** so the cheap, audit-required prose fixes
could ship inside the `backlog-skills-hardening` epic while this Tier-2 structural refactor stays
parked. Per CLAUDE.md atomicity (one item = one closure verdict): the residuals are audit findings
load-bearing for the epic `done_when`; this Tier-2 refactor is a non-audit enhancement orthogonal to
it. See `orchestrator-worker-seam-prose` for the residual fixes.

## Shipped 2026-06-23

Implemented the full Tier-2 plan (`docs/superpowers/plans/2026-06-23-tier2-epic-member-subagent-isolation.md`, rev4 design after the live `TIER2-GO` spike) on `feat/epic-member-subagent-isolation`:

- **Helpers (TDD):** `fork-key.mjs` (deterministic fork identity), `member-summary.mjs` (subagent-payload parser/validator, exit `0` needs-decision / `1` shipped / `2` blocked / `3` parse-failure), and `runstate.mjs` gains a required `fork_key` + supersede-aware `appendDecision` dedup + a `clear-e8` verb. Two pre-existing `appendDecision` tests were conformed to the now-required `fork_key`.
- **Agent type:** `.claude/agents/epic-member-worker.md` — `tools:` include `SendMessage`, exclude `AskUserQuestion`/`ExitPlanMode`; payloads are `SendMessage`'d to `main` (spike transport correction).
- **Orchestrator `/backlog-next-epic`:** E4 dispatches each member as an `epic-member-worker` subagent (named teammate; parse-loop on exit 0/1/2/3; two loop bounds; drainable ordering invariant); E4.5 demotes the per-member `/clear` to a dormant Tier-1 fallback; E5 handles `needs-decision` payloads + the honest floor model (prompting is NOT a backstop); E6.0 adds the advisory consistency audit + `supersedes` override; E8 PR-body groups by `[<member-id>]` + a distinct keep-iterating branch; new **§G** concurrency lock (atomic `wx`, no heartbeat, concurrency-by-discipline) + **§H** blocked-routing/inferred-too-large + **§I** observability + **§J** attribution.
- **Worker `/backlog-next`:** epic-member bubble-up delta (`SendMessage` `NEEDS-DECISION`, no `AskUserQuestion`; adopt pre-decided `(fork_key, chosen)`; `--auto` self-resolve+persist non-floor forks), `status: blocked` discriminating rule, `[<member-id>]` commit prefix, and the inline-execution assertions reconciled to subagent dispatch.

**Validation:** unit suites GREEN (`backlog-next-epic` 41/41, `backlog-next` 40/40); a 13/13 helper-level path-coverage harness; the `TIER2-GO` harness spike. The **live end-to-end `/backlog-next-epic` dry-run is post-merge / user-triggered** (the new skills are active only after this PR merges; `/backlog-next-epic` is `disable-model-invocation`) — filed as `tier2-live-end-to-end-dry-run` (parking, promote post-merge). Deferred follow-ups: `epic-member-floor-deny-hook` (mechanical floor gate for unattended runs) and `remove-tier1-clear-fallback` (after 3 successful Tier-2 epics).
