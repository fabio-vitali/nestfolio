# /backlog-next-epic Tier-2 — run each epic member as a context-isolated subagent

**Date:** 2026-06-23
**Status:** approved
**Backlog item:** `docs/backlog/backlog-next-epic-member-subagent-isolation.md` (active)
**Builds on / amends:** `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`
(the orchestrator design). This spec **supersedes** that spec's Tier-1 context-management parts
(the E4.5 per-member `/clear` checkpoint and the "inline Skill-tool load is the intended execution
model" framing) and changes **no** epic *model* rule (frontmatter + the 11 lint invariants, frozen
2026-06-16, stay untouched).

## Problem

`/backlog-next-epic` drives each member by invoking `/backlog-next <member>` via the **Skill tool
inline in the orchestrator's own conversation**. Every member's heavy work — file reads for editing,
investigation greps, `Explore` reports, deploy logs, integration output, debug→re-run loops —
accumulates in the orchestrator's context. Over a multi-member epic this exhausts the window
(surfaced on `order-execution-money-path`: 5 members, ~66% context at WS-5).

**Tier-1** (shipped, interim) mitigated this with the **E4.5 context checkpoint**: after each member
ships, emit a STABLE CHECKPOINT block and, in `--auto`, **unconditionally recommend a `/clear` +
resume** at the (provably safe) per-member boundary. This bounds context but pays a clear/resume
round-trip per member and — critically — the per-member `/clear` pause is itself a *user-facing
interruption* of `--auto`, which defeats the "launch it and walk away" goal (and the longer-term
target of running `--auto` unattended on GitHub runners).

## Goals

1. **Context isolation.** Each member's heavy work runs in a **subagent's** context, not the
   orchestrator's. The orchestrator's context grows only in compact per-member summaries + the
   decision log — roughly linear in member count, not in files-touched.
2. **Delete Tier-1.** Remove the E4.5 checkpoint/clear/resume mechanism (and the prose that depends
   on it). Tier-2 **replaces** Tier-1 — it does not stack on it. `--auto` no longer pauses to clear.
3. **Preserve every existing invariant.** One branch / one PR per epic, batched e2e at pre-done,
   the captured audit, the hard decision floor, append-only decision log, crash-resumability via
   run-state. Tier-2 changes *transport*, not the epic contract.
4. **Shape for unattended.** The decision bubble-up payload is machine-readable so a future GitHub
   runner can consume an un-resolvable floor decision as "fail the run" (wiring the runner is out of
   scope).

## Non-goals (out of scope)

- **Standalone `/backlog-next`** (a user running a single non-epic workstream directly) stays
  inline-loaded via the Skill tool. ONLY epic-**member** execution (driven by the orchestrator)
  moves to subagent dispatch.
- **GitHub-runner harness/auth.** This spec defines the `needs-decision`→fail signal; wiring
  `--auto` onto a CI runner (credentials, trigger, artifact capture) is a separate workstream.
- **`orchestrator-worker-seam-prose` residuals** (F-26/27/28/4/10) — owned by that member.
- **Redesign of the run-state JSON / member-frontmatter state model** — Tier-2 composes with it
  as-is (no schema change — see §A).
- **A system-wide backlog-system test framework** — deferred to its own backlog item (see
  "Deferred follow-ups").
- **Parallel member execution** — members stay sequential (one subagent at a time; they share one
  worktree/branch and commit sequentially). Non-goal carried from the 2026-06-21 spec.

## Design

### A. The shift, and what does NOT change

E4.2 changes from "invoke `/backlog-next` via the Skill tool inline" to "spawn a fresh
`epic-member-worker` **subagent** (Agent tool) that does the member work in its own context and
returns a compact summary." Applies to **both** interactive and `--auto` runs — the only
mode-difference is how a bubbled-up decision is handled (§D).

Two properties that deliberately **do not change**:

- **No run-state schema change.** Member *summaries* are NOT persisted — they live as compact
  one-line progress notes in the orchestrator's conversation. The existing append-only `decisions[]`
  already absorbs auto-resolved (§D) + floor (§D) + override (§E) entries. The closed 6-key
  `runstate.mjs` schema is untouched.
- **Subagent IDs are session-scoped, never persisted.** SendMessage-continuation (§C) is in-session
  only. If the orchestrator session dies, the existing **resume gate** re-dispatches the still-`active`
  member fresh from disk (frontmatter is the single source of truth). Crash-recovery is unchanged.

`fork` is explicitly **rejected** as the dispatch mechanism: a fork inherits the orchestrator's full
context, which is the opposite of isolation. The member runs in a *fresh* context.

### B. New artifact — `.claude/agents/epic-member-worker.md` (custom agent type)

Holds the stable **subagent wrapper contract** as a versioned, reviewable artifact (chosen over
reconstructing it as ephemeral dispatch prose — the contract is load-bearing and must not drift).
Clean 3-layer split, no duplication:

- **Agent definition** = the wrapper contract (this file).
- **`/backlog-next` epic-member mode** = member execution (single source of truth; one new line —
  §F).
- **Orchestrator dispatch prompt** = only the variable inputs (member id, branch, worktree absolute
  path, `--auto`, and on a re-dispatch the imposed ruling).

The agent definition specifies:
- **Role.** "Execute ONE epic member workstream in isolation, then return a compact summary. You are
  driven by `/backlog-next-epic`."
- **On start.** `cd` into the shared worktree (absolute path from the dispatch prompt; cwd-pinned
  caveats per `feedback-worktree-entry-cwd-pinned` — use `git -C`/absolute paths), confirm the
  branch, then invoke `/backlog-next <member-id>` in **epic-member mode**.
- **Bubble-up (mechanically enforced).** The agent's **tool allowlist EXCLUDES `AskUserQuestion`**
  (and `ExitPlanMode`), so the subagent *cannot* prompt the user even by mistake — bubble-up is the
  only path. Decisions are surfaced by ending the turn with a `NEEDS-DECISION` payload (§C).
- **`--auto` non-floor self-resolution (§D).** Resolve non-floor forks locally and report each in
  the summary's `decisions[]`.
- **Terminal.** End with a `MEMBER-SUMMARY` payload (§C).
- **Tools.** Broad (member work is open-ended): Bash, Read/Edit/Write, Grep/Glob, Skill, the Task
  tools, ToolSearch/MCP — minus `AskUserQuestion`/`ExitPlanMode`.
- **Investigation stays in the subagent.** All investigation (greps, file reads, and any `Explore`
  reports) MUST happen in the subagent's own context — that is precisely the heavy material Tier-2
  keeps out of the orchestrator (the `order-execution` surfacing case pulled two `Explore` reports
  inline). The subagent does this with its direct tools and, **if the harness permits agent
  nesting**, by dispatching its own read-only `Explore` sub-agents (confirmed in the spike, §Risk).
  If nesting is not permitted, the subagent investigates with direct tools — isolation from the
  orchestrator holds either way; only the subagent's *internal* fan-out differs.

This is the project's first custom agent type.

### C. The contract — two payloads + a validator helper

The *interactive* Agent tool has no structured-output `schema` option (that is a Workflow-only
feature), so the contract is fenced-JSON the orchestrator parses and validates via a new tested
helper `.claude/skills/backlog-next-epic/member-summary.mjs` —
`parseMemberOutput(text)` discriminates the two kinds, validates a CLOSED schema (clean error on
drift, mirroring `runstate.mjs`'s `validateRunState`), and exposes a `main()` CLI. Tested in
`test/member-summary.test.mjs`.

**`MEMBER-SUMMARY`** (terminal — member finished):

```json
{
  "kind": "member-summary",
  "member": "<id>",
  "lane": "doc-layer|simple|complex",
  "status": "shipped|blocked",
  "validation_gate": "<concrete evidence: integ command output, commit SHAs, doc-derivation note>",
  "commits": ["<sha> <subject>"],
  "decisions": [ { "decision": "...", "options": ["..."], "chosen": "...", "rationale": "...", "rejected": "..." } ],
  "blocked_reason": "<present iff status=blocked>"
}
```

- `decisions[]` are the `--auto` non-floor forks the subagent auto-resolved locally. The orchestrator
  appends each to run-state `decisions[]` (tagging `member`) via `append-decision` (append-only).
- `status: blocked` = the member genuinely cannot proceed (a missing precondition — NOT a decision,
  NOT a test failure). The orchestrator treats it as a floor surface (halt / re-plan).

**`NEEDS-DECISION`** (non-terminal — subagent parked, awaiting a ruling):

```json
{
  "kind": "needs-decision",
  "member": "<id>",
  "reason": "design-approval|floor:<which>|bounded-effort-exceeded|catch-all",
  "question": "<the fork, phrased for AskUserQuestion>",
  "options": [ { "label": "...", "description": "...", "recommended": true } ],
  "blast_radius": "<detect-fork-blast-radius.mjs result, if run>"
}
```

This same payload is the **machine-readable block signal** a future unattended runner consumes as
"fail the run with this reason" (the runner wiring is out of scope — we only shape the payload).

### D. E4 (member loop) + E5 (decision handling) rewrite

**E4.2 (dispatch + parse loop):**
1. Spawn `Agent({ subagent_type: "epic-member-worker", prompt: <member id, branch, worktree abs
   path, --auto, (re-dispatch) imposed ruling> })`.
2. Parse the returned text with `member-summary.mjs`:
   - `needs-decision` → **§E5**; after the ruling, `SendMessage(subagentId, <ruling>)` and re-parse
     the continued output. Loop until a `member-summary`.
   - `member-summary / shipped` → append its `decisions[]` to run-state; emit a **compact one-line
     progress note**; advance to the next member (re-derived via `epic-members.mjs`).
   - `member-summary / blocked` → surface `blocked_reason` (floor); halt / re-plan.
3. **DELETE E4.5 entirely** (the STABLE CHECKPOINT block + the unconditional `/clear` recommendation
   + the E4→E6 pre-clear). It is replaced by the one-line progress note — no pause, no clear.

**E5 (decision handling)** — decisions are now raised *inside* the subagent and arrive as
`needs-decision`:
- **Interactive:** every `needs-decision` → `AskUserQuestion` (recommended option marked per project
  rule) → `SendMessage` the ruling.
- **`--auto`:** non-floor forks NEVER reach the orchestrator (the subagent self-resolved them and
  reported them in its summary). **Floor** forks — the subagent classifies them via
  `detect-fork-blast-radius.mjs` (exit 1 ⇒ floor) + the irreversible-action list + the bounded-effort
  counter + a conservative catch-all (anything uncertain ⇒ floor) — arrive as `needs-decision` →
  `AskUserQuestion` (the floor pauses even in `--auto`) → `SendMessage` the ruling.
- **`type: design` approval** is `reason: design-approval` → ALWAYS bubbled up, never auto-resolved
  (unchanged guarantee, new transport: the worker emits `needs-decision` instead of calling its
  normal AskUserQuestion when it hits brainstorming's approval gate).
- The decision log is assembled from both sources, all via `append-decision` (append-only — a
  reversal is a NEW entry referencing the superseded index).

Also delete the Tier-1 artifacts: the E9 paragraph framing per-member `/clear` as routine, and the
"Trying to self-measure context" entry in "Common mistakes". (E9 **crash/interrupt** resumability via
the resume gate STAYS.)

### E. E6/E7 — cross-member consistency audit (the override anchor)

The orchestrator is the only actor holding the cumulative decision log across all (context-isolated)
members, so it is the only one positioned to catch a **cross-member inconsistency** that no
per-member test will (e.g. two members independently adding equivalent helpers). This authority is
**anchored to one concrete trigger** — a pre-done audit — rather than a free-floating "override
anytime" power (which would have no reliable trigger).

Add an E6/E7 sub-step, run once when `epic-members.mjs` reports drainable:
- The orchestrator reviews the cumulative `decisions[]` **+** the branch's new shared-surface
  additions (grep the branch diff vs `origin/main` for new exported helpers / event names / CDK
  constructs / shared-lib exports) for cross-member duplication or inconsistency.
- On a finding: append an append-only **override/reversal** entry to `decisions[]` (referencing the
  superseded index + rationale), **re-open** the affected member (`status: active`), and re-dispatch
  its subagent with the **imposed decision** in the prompt → per-member integration → HEAD moves →
  `e2e-fresh` invalidates the recorded green → **return to E6** batched e2e.
- In `--auto`, re-opening a shipped member is already a **floor** action ("forces rework of an
  already-shipped member", E5) → `AskUserQuestion` confirms the override before imposing.

This reuses the existing E6-recovery machinery (re-open → re-run → return to E6); the audit is the
*trigger*, the override is the *action*, both bounded to one pass (a finding re-opens, then re-audit).

### F. Worker (`/backlog-next` epic-member mode) delta

The single substantive change to the worker — its "Floor (self-contained)" delta gains:

> When you are running as the `epic-member-worker` subagent (the orchestrator's dispatch tells you
> so), you MUST NOT call `AskUserQuestion` — surface every decision that would otherwise pause by
> **ending your turn with a `NEEDS-DECISION` payload** (the orchestrator delivers the ruling via
> SendMessage; continue from there). In `--auto`, self-resolve non-floor forks (run
> `detect-fork-blast-radius.mjs`; exit 1 ⇒ escalate to floor/bubble-up; else pick the most-reusable
> `(Recommended)` option) and report each in the `MEMBER-SUMMARY` `decisions[]`.

Execution logic (lanes, spec→plan→code, per-member integration, doc-derivation, the
STOP-before-`finishing-a-development-branch` handoff) is otherwise unchanged.

## Decisions & alternatives rejected

| Decision | Choice | Rejected |
|----------|--------|----------|
| Dispatch scope | both interactive + `--auto` use subagent dispatch | `--auto`-only (two execution paths; interactive long epics still exhaust context) |
| Dispatch mechanism | fresh `epic-member-worker` subagent (Agent tool) | `fork` (inherits orchestrator context — defeats isolation) |
| Where the wrapper contract lives | versioned custom **agent type** | contract as ephemeral dispatch prose (drift-prone, not reviewable/testable) |
| Resume after a `needs-decision` | keep subagent alive + `SendMessage` the ruling (context intact) | always fresh re-dispatch from disk (re-does pre-decision work; forces sub-skills to be decision-log-aware) |
| `--auto` non-floor resolution site | inside the subagent (keeps fork context out of orchestrator) | bubble every fork to the orchestrator (re-injects member context per fork; round-trip per fork) |
| Override authority | anchored to a pre-done consistency audit (E6/E7) | free-floating anytime-override (no reliable trigger) · no override at all (misses non-breaking cross-member inconsistency before the single PR) |
| Tier-2 test scope | `member-summary.mjs` + tests + the SendMessage spike only | also extract `classify-fork.mjs` / add a fixture-epic rehearsal (deferred to the system-wide harness item) |

## Primary risk — validate FIRST (go/no-go gate)

The design hinges on **`SendMessage` continuing a parked subagent with its context intact**,
interleaved with the orchestrator's own `AskUserQuestion` turn. The Agent-tool docs state this is
supported, but it has not been exercised here. **The implementation plan's first step is a spike**
proving the full cycle: spawn agent → it ends a turn with a payload → orchestrator runs
`AskUserQuestion` → `SendMessage(id, ruling)` → agent resumes and returns the next payload. The
spike also confirms whether a subagent may dispatch its own (read-only `Explore`) sub-agents (§B) —
if not, the subagent investigates with direct tools (isolation from the orchestrator is unaffected).

**If the spike fails**, fall back to the rejected Q2 runner-up (fresh re-dispatch from a
disk-persisted ruling) — more re-work, but no live-continuation dependency — and the worker +
relevant sub-skill seams become decision-log-aware on (re)start. The spike's outcome is a go/no-go
gate before the E4/E5 rewrite.

## Deferred follow-ups

- **System-wide backlog-system test harness** (own backlog item, filed via `backlog-add` from the
  main root after this workstream): the deterministic helpers (`runstate`, `epic-members`,
  `detect-fork-blast-radius`, lint rules, pre/postflight) are unit-tested, but the **prose-driven
  orchestration** (E0–E9, decision policy, resume gate) has no automated coverage. The tractable
  strategy is (1) push more deterministic decisions out of prose into tested `.mjs` helpers, and
  (2) an optional fixture-epic smoke rehearsal (model-in-the-loop, non-deterministic — a manual
  rehearsal, not CI). Out of Tier-2 scope to avoid ballooning it.

## Verification

- `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` green — including the new
  `member-summary.test.mjs` (both payload kinds + malformed/drift rejection); `runstate` /
  `epic-members` / `detect-fork-blast-radius` suites unaffected (no run-state schema change).
- The SendMessage spike passes (or the documented fallback is adopted).
- Dry-run `/backlog-next-epic` on a small (2–3 core member) theme epic: each member runs in a
  subagent, the orchestrator transcript shows only one-line progress notes + the decision log (no
  member file-dumps), one branch / one PR, batched e2e once at pre-done, decision pauses surface via
  `AskUserQuestion`.
- `--auto` dry-run: no `/clear` pause between members; non-floor decisions appear in the decision
  log without interrupting; only floor forks pause; the consistency audit runs at pre-done.
- The orchestrator `SKILL.md` no longer contains the E4.5 checkpoint, the per-member `/clear` prose
  (E9), or the "Trying to self-measure context" common-mistake; the `2026-06-21` spec carries a
  correction note pointing here.
