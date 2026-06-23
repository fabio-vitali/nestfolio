# Tier-2 harness spike — go/no-go evidence (2026-06-23)

Spike for `docs/superpowers/plans/2026-06-23-tier2-epic-member-subagent-isolation.md` Task 1.
Run live from the main `/backlog-next-epic` session using a throwaway `_spike-probe` custom agent
type. **MODE: `TIER2-GO`** (for the attended dev-phase scope this workstream targets), with three
spec corrections folded into rev4 and one hard precondition for the (already-deferred) unattended
GitHub-runner use.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | SendMessage continuation (context intact) | **PASS** | `spikeprobe2` SendMessaged a NEEDS-DECISION carrying `secret=1782233170383850000`; after `SendMessage(ruling)` it resumed and replied `RESUMED received=RULING_TOKEN_99… stillRemember=1782233170383850000` — first-turn secret retained + follow-up received. |
| 2 | Custom agent-type resolution | **PASS** | `subagent_type:"_spike-probe"` resolved a `.claude/agents/*.md` created **mid-session**; an **edit** to it took effect on the next dispatch (defs are read fresh per dispatch). |
| 3 | Tool-allowlist exclusion ENFORCED | **PASS** | `spikeprobe3` reports `item3_hasAskUserQuestion=no` — an excluded tool is genuinely absent from the subagent (not advisory). Mechanical bubble-up guarantee holds. |
| 4 | Broad allowlist granted | **PASS** | Bash executed (`echo`), Skill/Agent present; member work is feasible. |
| 5 | Agent nesting (subagent spawns Explore) | **PASS** | `spikeprobe3` spawned a nested `Explore` that completed and returned a result (23K tokens, stayed in the probe's context). |
| 6 | Context-isolation proxy | **PASS (structural)** | A teammate's plain output is NOT visible to main — only its SendMessage'd payloads reach the orchestrator. The nested Explore's 23K tokens stayed in `spikeprobe3`'s context, never the main session's. Isolation is guaranteed by the communication model, not just by measurement. |
| 7 | Permission inheritance | **NOTE (permissive)** | The subagent ran shell commands with no prompt — it operates in a permissive context (no interactive gate for a background subagent). |
| 8 | Destructive-Bash behavior | **AUTO-PROCEEDS (floor-not-safe-unattended)** | `git branch -D _spike_no_such_branch_zzz` and `rm -rf /tmp/_spike_no_such_dir_zzz` both **EXECUTED** (no prompt, no block) — they were harmless no-ops, but a *real* destructive command would have run. Confirms the review's finding: default permission-prompting is NOT a floor backstop inside a subagent. |
| 9 | `Agent()` blocking semantics | **CORRECTION (concurrent, NOT blocking)** | A **named** agent spawns as a **background teammate** and returns immediately (`agent_id: …@session-…`); the orchestrator is NOT blocked. So "synchronous foreground ⇒ no intra-session concurrency" is false. |

## Decision

**`TIER2-GO`** — the four critical capabilities (1, 2, 3, plus the corrected 9) all work; the
mechanism is sound. The spike forced corrections that would otherwise have been implementation bugs.

## Mandatory corrections (fold into spec rev4 + plan)

1. **Transport = bidirectional `SendMessage`, NOT temp-file-final-message.** The worker (a named
   background teammate) `SendMessage`s `main` its `NEEDS-DECISION` / `MEMBER-SUMMARY` payloads;
   the orchestrator `SendMessage`s rulings back. `member-summary.mjs` still validates the payload
   JSON, but its input is the **message text** (the orchestrator may pass it via stdin/temp file to
   the validator — that file is an internal validator detail, not the transport). The worker's
   allowlist therefore **includes `SendMessage`** (to reach `main`) but still **excludes
   `AskUserQuestion`** — so the floor still cannot prompt the user; it messages the orchestrator.
2. **§G: concurrency by DISCIPLINE, not by blocking.** The worker runs concurrently with the
   orchestrator. The orchestrator must: dispatch exactly one member teammate at a time, **yield while
   it is live**, and **never run worktree/git-index operations during a live member turn** (its own
   git ops — the E6 deploy, the §E audit — run only between members, after a member's terminal
   summary). The cross-session `wx` lock still guards a second orchestrator session.
3. **§D floor: confirmed — prompting is NOT a backstop.** Item 8 proves destructive Bash
   auto-proceeds unprompted in a subagent. The floor's real gates remain the mechanical
   blast-radius check + the worker's irreversible-action checklist (bubble up, never attempt). The
   `permissions.deny` / `PreToolUse` deny-hook follow-up is a **HARD PRECONDITION before any
   unattended GitHub-runner use** (already out of scope here; attended dev `--auto` is acceptable
   because a human is present for floor pauses).

## Cleanup

Throwaway `.claude/agents/_spike-probe.md` deleted; `spikeprobe`/`spikeprobe2`/`spikeprobe3`
teammates shut down.
