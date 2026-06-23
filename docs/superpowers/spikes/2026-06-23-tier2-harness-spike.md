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

## Dry-run path coverage (2026-06-23, Task 8)

Two layers — the deterministic layer is DONE; the live end-to-end layer is post-merge / user-triggered.

**(A) Helper-level path coverage — DONE, deterministic (`13/13` green).** A throwaway harness (run from the worktree root; not committed — the durable coverage is the unit suites) exercised the exact routing/persistence logic the orchestrator prose drives, without a live orchestrator:
- `member-summary.mjs` exit-code routing — happy → exit 1; `needs-decision` → 0; `blocked` → 2; parse-failure (garbage / malformed / ambiguous-two-kinds) → 3; a narrative example-fence is ignored and the last operative block wins.
- `fork-key.mjs` determinism — same `(member, structured-subject)` → same key across a simulated re-dispatch; distinct subjects differ (distinct forks never collapse).
- `runstate.mjs appendDecision` — a non-superseding `(member, fork_key)` duplicate no-ops (no double-log); a `supersedes` override ALWAYS appends (dedup never drops it); 4 distinct fork_keys all append (a multi-fork interactive member is not force-floored).
- §G lock primitive — exclusive `wx` create is atomic; a second acquire throws `EEXIST` → refuse-and-ask.

This + the §Risk spike (harness primitives: SendMessage continuation, custom-agent-type resolution, allowlist exclusion, nesting, context isolation) + the unit suites (`backlog-next-epic` 41/41, `backlog-next` 40/40) cover every deterministic path.

**(B) Live end-to-end `/backlog-next-epic` dry-run — POST-MERGE / USER-TRIGGERED.** The full 2-member-epic dry-run (orchestrator prose driving a real `epic-member-worker` subagent through dispatch → `SendMessage` payload → parse → resolve/resume → ship) cannot run meaningfully from this pre-merge implementation session: (1) `/backlog-next-epic` loads from the **main** repo's `.claude/skills/`, so the NEW Tier-2 orchestrator is only the active skill **after this PR merges**; (2) it is `disable-model-invocation: true` (user-triggered only); (3) it needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; (4) it creates a throwaway 2-core-member doc-layer theme epic (a backlog mutation) and spawns real agents (cost). The path list to assert when it runs: happy-path (one-liners + decision log, no file-dumps); crash/resume mid-fork (no re-ask of a persisted ruling); override (worker ADOPTS the imposed value; dedup keeps the `supersedes` entry); blocked → AskUserQuestion (not a prose halt); parse-failure ≤2 repair then floor; inferred too-large → split (not generic floor); multi-fork interactive member NOT force-floored; `wx` lock contention → refuse-and-ask; + the context-isolation proxy (orchestrator per-member delta independent of files-touched). Tracked as a queued follow-up; the rollout already gates Tier-1 removal on **3 successful Tier-2 epics**, so real runs accumulate the live evidence.
