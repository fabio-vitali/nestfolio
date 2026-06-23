# /backlog-next-epic Tier-2 — run each epic member as a context-isolated subagent

**Date:** 2026-06-23
**Status:** approved (rev2 — hardened after a 101-agent adversarial deep review, 2026-06-23)
**Backlog item:** `docs/backlog/backlog-next-epic-member-subagent-isolation.md` (active)
**Builds on / amends:** `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`
(the orchestrator design). This spec **supersedes** that spec's Tier-1 context-management framing
(see Goal 2 — Tier-1 is *demoted to a migration guard*, not deleted outright) and the "inline
Skill-tool load is the intended execution model" framing. It changes **no** epic *model* rule
(frontmatter + the 11 lint invariants, frozen 2026-06-16) and makes **no change to the closed
6-key run-state schema** (it adds one additive CLI verb + a separate lock file — see §A, §G, §J).

## Problem

`/backlog-next-epic` drives each member by invoking `/backlog-next <member>` via the **Skill tool
inline in the orchestrator's own conversation**. Every member's heavy work — file reads, greps,
`Explore` reports, deploy logs, integration output, debug→re-run loops — accumulates in the
orchestrator's context. Over a multi-member epic this exhausts the window (surfaced on
`order-execution-money-path`: 5 members, ~66% context at WS-5).

**Tier-1** (shipped) mitigated this with the **E4.5 context checkpoint**: after each member ships,
recommend a `/clear` + resume at the per-member boundary. This bounds context but pays a
clear/resume round-trip per member, and the per-member `/clear` pause is itself a *user-facing
interruption* of `--auto` — which defeats "launch it and walk away" and the longer-term unattended
GitHub-runner target.

## Goals

1. **Context isolation.** Each member's heavy work runs in a **subagent's** context, not the
   orchestrator's. The orchestrator grows only in compact per-member progress notes + the decision
   log — bounded per member and **independent of files-touched** (the observable proxy verified in
   §Verification, replacing the unmeasurable "roughly linear" claim).
2. **Demote Tier-1 to a migration guard (NOT delete it yet).** The E4.5 `/clear` prose is **retained
   as a documented fallback** that does not fire on the Tier-2 happy path, kept until **N = 3
   successful Tier-2 epics**, after which a follow-up item removes it. Rationale (deep-review
   condition #9): deleting the only known-working context mechanism on a single dry-run leaves no
   rollback if the subagent transport proves flaky in a real epic. The item's *intent* (no
   per-member pause in the happy path) is met; the guard only fires on Tier-2 failure.
3. **Preserve every existing invariant.** One branch / one PR, batched e2e at pre-done, the captured
   audit, the hard decision floor, append-only decision log, crash-resumability via run-state. Tier-2
   changes *transport*, not the epic contract.
4. **Shape for unattended.** The `needs-decision` payload is machine-readable so a future GitHub
   runner can consume an un-resolvable floor decision as "fail the run" (wiring the runner is out of
   scope).

## Non-goals (out of scope)

- **Standalone `/backlog-next`** (a user running a single non-epic workstream directly) stays
  inline-loaded. ONLY epic-**member** execution (driven by the orchestrator) moves to subagents.
- **GitHub-runner harness/auth** (only the `needs-decision`→fail *signal* is designed here).
- **`orchestrator-worker-seam-prose` residuals** (F-26/27/28/4/10) — owned by that member.
- **A system-wide backlog-system test framework** — deferred to its own item (Deferred follow-ups).
- **Parallel member execution** — members stay sequential, **one subagent at a time, dispatched
  synchronously in the foreground** (the orchestrator blocks on the `Agent`/`SendMessage` result),
  so within a single orchestrator session the orchestrator and the member subagent are **never
  concurrent** (this is load-bearing for §G).

## Design

### A. The shift, and what does NOT change

E4.2 changes from "invoke `/backlog-next` via the Skill tool inline" to "spawn a fresh
`epic-member-worker` **subagent** (Agent tool) synchronously; it does the member work in its own
context and returns a compact summary." Applies to **both** interactive and `--auto` runs (the only
mode-difference is decision handling, §D) — with the interactive-visibility mitigation in §I.

What deliberately **does not change:**

- **No run-state schema change.** Member *summaries* are NOT persisted to run-state — the per-member
  PR-body line is reconstructed from `git log` (§J), and the decision log uses the existing
  `decisions[]`. The closed 6-key schema is untouched. Two **additive** changes that do NOT alter
  the schema: a new `runstate.mjs clear-e8 <id>` CLI verb (removes the optional `e8` key — §J), and
  a **separate lock file** (NOT a run-state key — §G).
- **Crash-resumability is unchanged in shape.** Subagent IDs are session-scoped and never persisted;
  if the orchestrator session dies, the resume gate re-dispatches the still-`active` member fresh
  from disk. The mid-fork-correctness of that re-dispatch is hardened in §D.

`fork` is rejected as the mechanism (it inherits the orchestrator's full context — the opposite of
isolation). The member runs in a fresh context.

### B. New artifact — `.claude/agents/epic-member-worker.md` (custom agent type)

Holds the stable **subagent wrapper contract** as a versioned, reviewable artifact. Clean 3-layer
split (agent-def = wrapper contract; `/backlog-next` epic-member mode = execution; orchestrator
dispatch prompt = variable inputs). The agent definition specifies:

- **Role.** "Execute ONE epic member workstream in isolation; return a compact summary. Driven by
  `/backlog-next-epic`."
- **On start.** `cd` into the shared worktree (absolute path from the dispatch prompt; cwd-pinned
  caveats per `feedback-worktree-entry-cwd-pinned`), confirm branch, then invoke
  `/backlog-next <member-id>` in **epic-member mode**.
- **Bubble-up (intended to be mechanically enforced).** The agent's tool allowlist EXCLUDES
  `AskUserQuestion`/`ExitPlanMode`. Decisions are surfaced by ending the turn with a `NEEDS-DECISION`
  payload (§C). **This mechanical guarantee is UNVERIFIED until the §Risk spike proves the harness
  enforces allowlist exclusion** — if it does not, the design falls back to honor-system bubble-up
  (prose-only) and the spec is reworked (see §Risk).
- **`--auto` non-floor self-resolution (§D).** Resolve non-floor forks locally; report each in the
  summary's `decisions[]`.
- **Investigation stays in the subagent.** All greps/reads/`Explore` reports happen in the
  subagent's context (that is the heavy material Tier-2 keeps out of the orchestrator). The subagent
  uses direct tools and — **if the spike confirms agent nesting** — its own read-only `Explore`
  sub-agents; if nesting is unavailable it investigates with direct tools (isolation from the
  orchestrator holds either way). A member whose work cannot fit a single subagent's context is
  **mis-scoped** — the worker bubbles it up as `status: blocked` for the user to split (§H), rather
  than looping a deterministically-re-exhausting fresh re-dispatch.
- **Tools.** Broad (member work is open-ended): Bash, Read/Edit/Write, Grep/Glob, Skill, the Task
  tools, ToolSearch/MCP, Agent (for Explore) — minus `AskUserQuestion`/`ExitPlanMode`.

This is the project's first custom agent type (hence the §Risk verification of the capability).

### C. The contract — two payloads + a fully-specified validator helper

The *interactive* Agent tool has no structured-output `schema` option, so the contract is fenced
JSON the orchestrator parses + validates via a new tested helper
`.claude/skills/backlog-next-epic/member-summary.mjs`, specified to `runstate.mjs`'s standard:

**Invocation contract (deep-review blocker #2/#3 + the seam gap):**
- **Input.** The orchestrator writes the subagent's verbatim final message to a temp file and runs
  `node member-summary.mjs parse <file>` (a file, not argv — the message is multi-line free text).
- **Extraction algorithm.** Scan for fenced ```json blocks whose object has a `kind` field. Take the
  **last** such block (the contract requires the payload be the final fenced block; trailing prose
  is ignored). **Precedence / violation:** more than one `kind`-bearing block, or a block whose
  `kind` disagrees with another, is a **contract violation → parse-failure** (no silent pick).
- **Exit-code table** (mirrors `runstate.mjs`), so the prose E4.2 loop branches deterministically:
  `0` = valid `needs-decision`; `1` = valid `member-summary` / `status: shipped`;
  `2` = valid `member-summary` / `status: blocked`; `3` = **parse-failure** (no payload / malformed
  / multiple / schema-invalid), with a clean stderr message.
- **Closed-schema validation** of BOTH payloads (like `validateRunState`): unknown keys rejected;
  `needs-decision` requires `reason`∈enum, `question`, and `options[]` each with
  `label`/`description`/`recommended`; `member-summary` requires `lane`∈enum, `status`∈enum,
  `validation_gate`, `commits[]`, `decisions[]`, and `blocked_reason` iff `status: blocked`.

**Parse-failure recovery (no stall — blocker #3).** On exit `3` the orchestrator issues ONE
**`SendMessage` repair turn** ("your last message did not contain exactly one valid payload; re-emit
ONLY the JSON payload") and re-parses, **bounded to ≤2 repair attempts**; still failing ⇒ treat as a
**floor pause** (surface to the user). The whole `needs-decision`↔`SendMessage` continuation loop
also has an **orchestrator-side liveness cap** (max N round-trips per member, default 8; exceeding it
⇒ floor pause) so a misbehaving subagent can never spin the orchestrator forever.

**`MEMBER-SUMMARY`** (terminal):

```json
{ "kind": "member-summary", "member": "<id>", "lane": "doc-layer|simple|complex",
  "status": "shipped|blocked",
  "validation_gate": "<CONCISE evidence: integ pass/fail + commit SHAs + doc-derivation note — NOT raw logs>",
  "commits": ["<sha> <subject>"],
  "decisions": [ { "decision":"...","options":["..."],"chosen":"...","rationale":"...","rejected":"...","fork_key":"<stable hash>" } ],
  "blocked_reason": "<present iff status=blocked: why the member cannot proceed (e.g. mis-scoped/too-large, missing precondition)>" }
```

- `validation_gate`/`commits[]` are **bounded** — concise evidence, never raw test logs (deep-review:
  prevents per-member log dumps re-bloating the orchestrator).
- `decisions[]` are ONLY the `--auto` non-floor forks the subagent auto-resolved (§D division of
  labor); each carries a `fork_key` for dedup (§D).
- `status: blocked` = the member genuinely cannot proceed — NOT a decision, NOT a test failure (§H).

**`NEEDS-DECISION`** (parked, awaiting a ruling):

```json
{ "kind": "needs-decision", "member": "<id>",
  "reason": "design-approval|floor:<which>|bounded-effort-exceeded|catch-all",
  "question": "<the fork, phrased for AskUserQuestion>",
  "deliberation": "<for design-approval: the brainstorming summary/reasoning behind the options — §I>",
  "options": [ { "label":"...","description":"...","recommended":true } ],
  "fork_key": "<stable hash for dedup>",
  "blast_radius": "<detect-fork-blast-radius.mjs result, if run>" }
```

This payload is also the machine-readable **block signal** a future unattended runner consumes as
"fail the run with this reason."

### D. E4 (member loop) + E5 (decision handling) rewrite

**E4.2 (dispatch + parse loop):**
1. Spawn `Agent({ subagent_type: "epic-member-worker", prompt: <member id, branch, worktree abs
   path, --auto, AND the member's already-resolved decisions[] (so a re-dispatch is decision-aware,
   see below)> })`, synchronously.
2. Write the returned final message to a temp file; branch on `member-summary.mjs parse` exit code:
   - `0` (needs-decision) → **§E5**; **persist the ruling to `decisions[]` AT RESOLUTION TIME (before
     SendMessage)**, then `SendMessage(subagentId, <ruling>)` and re-parse the continued output.
   - `1` (shipped) → append the summary's `decisions[]` (deduped by `fork_key`); emit a **compact
     one-line progress note**; **only now** consult `epic-members.mjs` to advance (ordering invariant
     below).
   - `2` (blocked) → §H (route through AskUserQuestion).
   - `3` (parse-failure) → repair turn + bounded retry (§C); then floor.
3. **DELETE from the happy path** the E4.5 STABLE CHECKPOINT + the unconditional `/clear` — but
   **RETAIN the E4.5 `/clear` prose as a clearly-labelled migration-guard fallback** (Goal 2, §H).

**Persisted-decision correctness (blockers/majors — cold-resume + mid-fork crash):**
- Every ruling is appended to run-state `decisions[]` **at resolution time** (before SendMessage),
  not only at MEMBER-SUMMARY. So a crash *after* the ruling but *before* the summary does not lose it.
- The (re)dispatched worker is **decision-log-aware on start**: the orchestrator passes the member's
  existing `decisions[]` in the dispatch prompt, and the worker treats an already-resolved
  `fork_key` as pre-decided (no re-ask). This closes cold-resume-mid-fork AND the §E override
  re-dispatch (which would otherwise re-ask).

**Two-source decision log — division of labor (invariant) + dedup:**
- The **subagent** logs ONLY non-floor auto-resolved forks (in its summary `decisions[]`).
- The **orchestrator** logs ONLY floor/override rulings (at resolution time).
- A bubbled fork must NOT also be self-logged by the subagent. `appendDecision` gains an
  **idempotency guard keyed on `member`+`fork_key`** so a double-log into the append-only list (and
  thus the PR body) is impossible.

**Drainable ordering invariant.** The orchestrator must NOT consult `epic-members.mjs` (drainable
check / next-member pick) for a member until **after** that member's `member-summary` has been
parsed and its `decisions[]` appended — even though the worker commits `status: shipped` to disk
mid-turn. This prevents advancing to E6 before a just-shipped member's decisions are recorded.

**E5 (decision handling):**
- **Interactive:** every `needs-decision` → `AskUserQuestion` (recommended option marked) →
  SendMessage the ruling. The orchestrator **validates the payload's options before rendering**
  (the `(Recommended)` marking and `reason` are checked, not trusted verbatim — they come from a
  subagent).
- **`--auto`:** non-floor forks never reach the orchestrator (subagent self-resolved + logged).
  **Floor** forks — classified by `detect-fork-blast-radius.mjs` (exit 1 ⇒ floor) + the
  irreversible-action list + the bounded-effort counter + a conservative catch-all — arrive as
  `needs-decision` → `AskUserQuestion` → SendMessage.
- **`type: design` approval** → always bubbled (`reason: design-approval`), carrying `deliberation`
  (§I), never auto-resolved.
- **Floor enforcement — what actually gates a floor action (blocker #1).** The "harness/CLAUDE.md
  confirmation layer" claimed in the prior design **does not exist in this repo** (`settings.json`
  has only `env`+`statusLine`; no `hooks`, no deny rules). So the floor's real gates are: (a) the
  **tested `detect-fork-blast-radius.mjs`** (mechanical, not prose) for scope-boundary; (b) the
  subagent's **excluded `AskUserQuestion`** — it physically cannot self-approve a user-facing pause
  (pending §Risk verification); and (c) for genuinely destructive shell actions, the harness's
  default permission prompting still intercepts the `Bash` call — but because the subagent cannot
  answer a prompt, such a call **blocks/fails inside the subagent** rather than proceeding, which the
  worker surfaces as `needs-decision: floor` (it never silently proceeds). The floor classification
  living in the subagent is acceptable BECAUSE its load-bearing parts are mechanical (blast-radius
  exit code + tool-exclusion + permission-block), not a judgement the subagent could fabricate.

### E. E6/E7 — scoped cross-member consistency audit (the override anchor)

The orchestrator is the only actor holding the cumulative decision log, so it is the only one that
can catch a cross-member inconsistency no per-member test will (two members independently adding
equivalent helpers). Anchored to one trigger (pre-done), bounded to one pass, and **scoped to keep
the raw diff out of the orchestrator** (deep-review: the audit must not dump the whole branch diff):

- Run a scoped helper/grep that returns a **SUMMARY ONLY** — the set of new exported symbols
  (helpers / event names / CDK constructs / shared-lib exports) added per member + duplication
  flags — never the raw diff.
- On a finding: append an append-only **override** entry to `decisions[]` (referencing the
  superseded `fork_key` + rationale), **re-open** the affected member (`status: active`), and
  re-dispatch its subagent **with the imposed decision + the member's `decisions[]` (decision-aware,
  §D)** → per-member integration → HEAD moves → `e2e-fresh` invalidates the recorded green →
  **return to E6**.
- In `--auto`, re-opening a shipped member is a **floor** action → `AskUserQuestion` confirms first.

### F. Worker (`/backlog-next` epic-member mode) delta — INCLUDING reconciliation

The substantive execution change is one clause, BUT the worker `SKILL.md` also has stale
inline-execution assertions that contradict Tier-2 and MUST be reconciled (deep-review major):

- **Add to "Floor (self-contained)":** "When running as the `epic-member-worker` subagent, do NOT
  call `AskUserQuestion`; surface every decision that would otherwise pause by ending your turn with
  a `NEEDS-DECISION` payload (the orchestrator delivers the ruling via SendMessage; continue, and
  treat any `fork_key` already in your passed-in `decisions[]` as pre-decided). In `--auto`,
  self-resolve non-floor forks (`detect-fork-blast-radius.mjs`; exit 1 ⇒ floor/bubble-up; else pick
  the most-reusable `(Recommended)`) and report each (with `fork_key`) in `MEMBER-SUMMARY`."
- **Rescind/rewrite the now-contradictory clause** "Floor (self-contained) … pause via
  AskUserQuestion (a prose pause is a skill violation)" — under subagent dispatch the pause IS the
  `NEEDS-DECISION` end-of-turn, and AskUserQuestion is excluded by the allowlist.
- **Reconcile the "inline, not a detached subagent" assertions** in the worker `SKILL.md` (the
  "When to invoke" + epic-member-mode prose that hard-codes inline Skill-tool loading as THE model)
  and the epic-member guard's inline-load trigger — they now describe the SUPERSEDED model and must
  be updated to "the orchestrator dispatches epic members as `epic-member-worker` subagents."
- **Define `status: blocked` emission (§H).** Otherwise execution logic (lanes, spec→plan→code,
  per-member integration, doc-derivation, STOP-before-`finishing`) is unchanged.

### G. Concurrency / re-entrancy + worktree mutual-exclusion (NEW — deep-review gaps)

Detaching members introduces a failure class the inline (single-conversation) model could not have:
a second `/backlog-next-epic <id>` invocation (or a CI retry) while a member subagent is still alive
would double-dispatch a SECOND subagent into the same shared worktree/branch.

- **Cross-session lock (separate file, NOT a run-state key — preserves the closed schema).** A
  `<git-common-dir>/backlog-next-epic-<id>.lock` carries `{ session-id, heartbeat-ts }`. The resume
  gate, before re-dispatching, checks it: **fresh heartbeat ⇒ another orchestrator is live → refuse
  and ask** (resume-vs-abort); **stale/absent ⇒ reclaim** (the prior session crashed). The lock is
  released on the E8 hand-off / on clean exit.
- **Intra-session: no concurrency by construction.** Because dispatch is synchronous foreground
  (§Non-goals), the orchestrator is blocked while a subagent runs — they never touch the shared
  `.git/index` simultaneously within one session. The orchestrator's own worktree git ops (the E6
  deploy, the §E audit) run only between members, never during a live subagent turn. (This is the
  load-bearing reason parallel members stay a non-goal.)

### H. Migration guard + subagent context-exhaustion (NEW — deep-review)

- **Tier-1 retained as a fallback (Goal 2).** The E4.5 `/clear` prose stays in the orchestrator
  `SKILL.md`, explicitly labelled "migration-guard fallback — does not fire on the Tier-2 happy
  path; retained until 3 successful Tier-2 epics, then removed by `<follow-up item>`." The
  "self-measure context" common-mistake note is likewise retained but re-scoped to the guard.
- **Subagent context-exhaustion recovery.** A subagent cannot `/clear` itself. A member large enough
  to exhaust a fresh subagent's context would re-exhaust deterministically on re-dispatch — so it is
  **mis-scoped**: the worker bubbles it up as `status: blocked` (reason: too-large) and the
  orchestrator routes it through AskUserQuestion to **split the member** (`backlog-add` a split),
  rather than looping. This is the honest recovery (members must be context-sized).
- **`status: blocked` end-to-end.** Worker emits `MEMBER-SUMMARY status:blocked + blocked_reason`
  when a member cannot proceed (mis-scoped/too-large, missing precondition — distinct from a fork or
  a test failure). Orchestrator routes it via **AskUserQuestion** (NOT a prose halt — E5's
  no-prose-pause rule), options sourced as: abort-epic / file-follow-up-and-skip / split-and-retry.

### I. Interactive-mode observability (your call: keep both-modes + mitigate)

Both modes isolate members into subagents, accepting that a watching non-`--auto` user no longer
sees the member's greps/plan/debug scroll by. The regression is mitigated where it matters most:
- The `design-approval` `NEEDS-DECISION` payload MUST carry `deliberation` — the brainstorming
  summary and the reasoning behind the options — so the user approves a design with its context, not
  a bare options list.
- The orchestrator's per-member progress note names what the member did (lane, key files/services
  touched, decisions auto-resolved) so an interactive user retains a meaningful trace.
- Acknowledged cost: full live visibility/interjection mid-member is reduced versus today. (A user
  wanting to drive a single workstream interactively still uses standalone `/backlog-next`.)

### J. E8 PR-body reconstruction + `e8` marker lifecycle (deep-review majors)

- **PR-body is reconstructed from DURABLE sources** (member summaries are not persisted, but the
  inputs are): the per-member commit summary from `git log origin/main..HEAD` on the branch
  (commits are durable), and the decision section from run-state `decisions[]` (durable). So E8
  composes correctly even on a fresh-session resume.
- **`e8` lifecycle.** Add an additive `runstate.mjs clear-e8 <id>` verb (removes the optional `e8`
  key; not a schema change). If the user picks **"keep iterating"** at the E8 PR stop (after `e8:
  PR_OPEN_AWAITING_MERGE` is set), the orchestrator: re-attaches the worktree (E2 idempotent),
  `clear-e8`, and re-enters the member loop (E4). The §E override path (which can run before E8)
  likewise has a defined return-to-loop.

## Decisions & alternatives rejected

| Decision | Choice | Rejected |
|----------|--------|----------|
| Dispatch scope | both interactive + `--auto` use subagents (+ §I visibility mitigation) | `--auto`-only (interactive long epics still exhaust context) |
| Dispatch mechanism | fresh `epic-member-worker` subagent | `fork` (inherits orchestrator context) |
| Wrapper-contract home | versioned custom **agent type** (verified by the spike) | ephemeral dispatch prose (drift-prone, unreviewable) |
| Resume after `needs-decision` | keep subagent alive + `SendMessage`; persist ruling at resolution time; decision-aware re-dispatch as the cold fallback | fresh re-dispatch as the *primary* path (re-does pre-decision work) |
| `--auto` non-floor site | inside the subagent | bubble every fork (re-injects member context per fork) |
| Override authority | scoped pre-done consistency audit (summary-only) | free-floating anytime override · no override at all |
| Tier-1 fate | **demote to migration guard** until 3 successful Tier-2 epics | delete outright on one dry-run (no rollback) |
| Concurrency guard | separate lock file (session-id + heartbeat) | a run-state key (would change the closed schema) · nothing (double-dispatch risk) |
| Tier-2 test scope | `member-summary.mjs` + tests + the (expanded) spike | `classify-fork.mjs` / fixture-epic rehearsal (deferred to the system-wide harness item) |

## Primary risk — EXPANDED spike (go/no-go gate, BEFORE any rewrite or Tier-1 demotion)

The design hinges on harness capabilities that have no in-repo precedent. The plan's first step is a
spike proving ALL of the following; any failure forces the documented fallback or a rework **before**
the E4/E5 rewrite:

1. **SendMessage continuation.** spawn agent → it ends a turn with a payload → orchestrator runs
   `AskUserQuestion` → `SendMessage(id, ruling)` → agent resumes with context intact and returns the
   next payload. (Docs + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, verified present, support this;
   the spike confirms it end-to-end.)
2. **Custom agent type is honored.** `subagent_type: "epic-member-worker"` resolves
   `.claude/agents/epic-member-worker.md`.
3. **Tool-allowlist exclusion is ENFORCED, not advisory.** The subagent genuinely **cannot** call
   `AskUserQuestion`/`ExitPlanMode`. **If exclusion is not enforced**, the mechanical bubble-up
   guarantee (§B) fails → fall back to honor-system bubble-up (prose) and re-evaluate whether the
   custom agent type still earns its place over general-purpose.
4. **Broad allowlist granted** (Bash/Skill/Task) so the subagent can actually do member work + invoke
   `/backlog-next`.
5. **Agent nesting** — whether the subagent may spawn its own read-only `Explore` agents (if not,
   direct-tool investigation; §B).
6. **Context-isolation success criterion (NOT just transport).** Measure that the orchestrator's
   per-member context delta (turn-count + payload bytes) is **bounded and independent of
   files-touched** — run a trivial member vs a file-heavy member and confirm the orchestrator delta
   is ~constant. This is the proxy that proves the actual GOAL, not merely that SendMessage works.

**Fallback if SendMessage fails:** fresh re-dispatch from disk-persisted rulings (now first-class
via §D's decision-aware re-dispatch) — more re-work, no live-continuation dependency.

## Deferred follow-ups

- **System-wide backlog-system test harness** (own item, filed via `backlog-add` from the main
  root): the deterministic helpers are unit-tested, but the prose orchestration (E0–E9, decision
  policy, resume gate) has no automated coverage. Strategy: push deterministic decisions into tested
  `.mjs` helpers + an optional model-in-the-loop fixture-epic rehearsal. Out of Tier-2 scope.
- **Remove the Tier-1 migration guard** (own item): delete the retained E4.5 `/clear` fallback after
  3 successful Tier-2 epics.

## Verification

- `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` green — including the new
  `member-summary.test.mjs`: both payload kinds, the **extraction algorithm** (fenced block, trailing
  prose, **multiple/decoy blocks ⇒ parse-failure**), the **exit-code table** (0/1/2/3), and
  closed-schema rejection. `runstate`/`epic-members`/`detect-fork-blast-radius` suites unaffected
  (no run-state schema change); add a `clear-e8` + idempotent-`appendDecision`(by `fork_key`) test to
  `runstate.test.mjs`.
- **The expanded §Risk spike passes** (all 6 items) or the documented fallback is adopted — go/no-go
  before the rewrite.
- **Path coverage (not just happy path)** in the dry-run on a small (2–3 member) theme epic:
  - happy path: each member in a subagent; orchestrator transcript shows only one-line notes + the
    decision log (no member file-dumps); one branch / one PR; batched e2e once at pre-done.
  - **crash/resume mid-fork:** kill the orchestrator after a ruling is persisted but before the
    summary → resume re-dispatches the member and does **not** re-ask the resolved fork.
  - **override:** the E6/E7 audit re-opens a member with an imposed decision; HEAD moves; `e2e-fresh`
    forces a return to E6.
  - **blocked:** a member emits `status: blocked` → routed via AskUserQuestion (not a prose halt).
  - **parse-failure:** a subagent emits malformed/no payload → repair turn fires, bounded, then floor.
  - **concurrency:** a second `/backlog-next-epic <id>` while the lock heartbeat is fresh → refused.
- **Context-isolation proxy** (the central claim): orchestrator per-member turn-count + payload bytes
  are bounded and independent of files-touched (measured trivial-vs-file-heavy member).
- The orchestrator `SKILL.md` keeps the E4.5 prose **only** as a labelled migration-guard fallback;
  the worker `SKILL.md` inline-execution assertions are reconciled; the `2026-06-21` spec carries a
  correction note pointing here.

## Revision log

- **rev2 (2026-06-23)** — hardened after a 101-agent adversarial deep review (go-with-conditions).
  Folded in: the EXPANDED spike (custom-agent-type + allowlist-enforcement verification, context
  proxy); the full `member-summary.mjs` invocation/extraction/exit-code/repair/liveness contract +
  payload precedence; persist-ruling-at-resolution-time + decision-aware re-dispatch; two-source
  decision-log division-of-labor + `fork_key` dedup; drainable ordering invariant; `status: blocked`
  end-to-end; floor-backstop correction (no harness hooks exist — mechanical gates only); scoped
  (summary-only) consistency audit; concurrency lock + intra-session no-concurrency rationale;
  Tier-1 demoted to a migration guard (+ subagent context-exhaustion → split); interactive-visibility
  mitigation (design-approval `deliberation`); E8 PR-body reconstruction from `git log` + run-state;
  `clear-e8` + "keep iterating" lifecycle; worker `SKILL.md` reconciliation; strengthened Verification.
- **rev1 (2026-06-23)** — initial design from the brainstorming Q&A (5 forks).
