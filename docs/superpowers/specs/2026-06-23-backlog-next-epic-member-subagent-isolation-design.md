# /backlog-next-epic Tier-2 — run each epic member as a context-isolated subagent

**Date:** 2026-06-23
**Status:** approved (rev3 — hardened after two adversarial deep-review rounds, 2026-06-23)
**Backlog item:** `docs/backlog/backlog-next-epic-member-subagent-isolation.md` (active)
**Builds on / amends:** `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`.
This spec supersedes that spec's Tier-1 context framing (Tier-1 becomes a *spike-gated fallback
mode*, not deleted) and the "inline Skill-tool load is the intended execution model" framing. It
changes **no** epic *model* rule (frontmatter + 11 lint invariants, frozen 2026-06-16).

**Spec altitude note.** This spec pins *contracts and constraints*. Mechanism-exact details flagged
"[plan]" (e.g. the precise `fork_key` hash input, the lock file's on-disk format) are finalized in
the implementation plan + proven by the §Risk spike — not in further spec rounds.

## Problem

`/backlog-next-epic` drives each member by invoking `/backlog-next <member>` via the **Skill tool
inline in the orchestrator's own conversation**, so every member's heavy work (reads, greps,
`Explore` reports, deploy/integration logs, debug loops) accumulates in the orchestrator's context
and exhausts the window over a multi-member epic (`order-execution-money-path`: 5 members, ~66% at
WS-5). Tier-1's per-member `/clear` checkpoint bounds this but pays a clear/resume per member and
turns `--auto` into a per-member *interruption*, defeating "walk away" + the unattended target.

## Goals

1. **Context isolation.** Each member's heavy work runs in a **subagent's** context. The
   orchestrator grows only in compact per-member progress notes + the decision log — bounded per
   member **and per bubbled fork** (each a fixed-size payload), **independent of files-touched**
   (the observable proxy in §Verification, replacing the unmeasurable "roughly linear" claim).
2. **Tier-1 becomes a spike-gated FALLBACK MODE (not deleted).** If the §Risk spike fails, Tier-1
   (the unconditional per-member `/clear`) is the selected mode and its prose stays authoritative. On
   spike success, Tier-2 is the mode and the Tier-1 `/clear` prose is **dormant** (retained as a
   labelled fallback, not a per-member runtime toggle) until **N = 3 successful Tier-2 epics**, after
   which a follow-up item removes it. (Rationale: don't delete the only known-working context
   mechanism before the new one is proven in production.)
3. **Preserve every existing invariant** — one branch / one PR, batched e2e at pre-done, captured
   audit, the hard floor, append-only-with-supersede decision log, crash-resumability.
4. **Shape for unattended** — the `needs-decision` payload is the machine-readable "fail the run"
   signal a future GitHub runner consumes (wiring the runner is out of scope).

## Non-goals (out of scope)

- **Standalone `/backlog-next`** stays inline-loaded; ONLY epic-**member** execution moves to subagents.
- **GitHub-runner harness/auth** (only the `needs-decision`→fail *signal* is designed).
- **`orchestrator-worker-seam-prose` residuals** (F-26/27/28/4/10) — owned by that member.
- **System-wide backlog-system test framework** — own item (Deferred follow-ups).
- **A `permissions.deny` / PreToolUse hook** that would make the floor a true mechanical gate for
  unattended runs — recommended as a follow-up (§D), not built here.
- **Parallel member execution** — members are sequential, **one subagent at a time, dispatched
  synchronously in the foreground**; the orchestrator blocks on the `Agent`/`SendMessage` result, so
  within one session the orchestrator and the member subagent are never concurrent (load-bearing for §G).

## Design

### A. The shift, and the precise state-change footprint

E4.2 changes from "invoke `/backlog-next` inline" to "spawn a fresh `epic-member-worker` subagent
(Agent tool) synchronously; it works in its own context and returns a compact summary." Applies to
**both** modes (decision handling differs, §D/§E; interactive-visibility mitigation, §I).

**State-change footprint (corrected — rev2 over-claimed "no change"):**
- The **top-level closed 6-key run-state schema is unchanged** (`{epic,branch,worktree,auto,decisions,e2e}` + optional `e8`).
- BUT the **decision-ENTRY shape gains a required `fork_key` field** (§C-fork_key), and
  `appendDecision` is **no longer a pure unconditional append** — it gains a conditional dedup/
  supersede branch (§D) and a `fork_key` validation. These ARE behavior changes to `runstate.mjs`
  (with tests), just not to the top-level key set. The spec says so honestly.
- A new additive `runstate.mjs clear-e8 <id>` verb (removes optional `e8`).
- A **separate lock file** (NOT a run-state key — §G).
- Subagent IDs are session-scoped, never persisted; on session death the resume gate re-dispatches
  the still-`active` member fresh from disk (correctness hardened in §D).

`fork` is rejected as the mechanism (inherits orchestrator context).

### B. New artifact — `.claude/agents/epic-member-worker.md` (custom agent type)

Stable wrapper contract; 3-layer split (agent-def = wrapper; `/backlog-next` epic-member mode =
execution; dispatch prompt = variable inputs). Specifies:
- **Role / on-start.** `cd` into the shared worktree (abs path from prompt), confirm branch, invoke
  `/backlog-next <member-id>` in epic-member mode.
- **Bubble-up (mechanically enforced *pending spike*).** Allowlist EXCLUDES
  `AskUserQuestion`/`ExitPlanMode`; decisions surface as a `NEEDS-DECISION` end-of-turn payload.
  **Unverified until §Risk spike items 2-3** prove the harness enforces exclusion; if not enforced →
  honor-system bubble-up + re-evaluate the custom type.
- **`--auto` non-floor self-resolution.** Resolve non-floor forks locally AND **append each to
  run-state at resolution time** (§D) — the subagent is in the worktree and calls
  `runstate.mjs append-decision`.
- **Investigation stays in the subagent** (greps/reads/`Explore`). A member too large for one
  subagent's context is **mis-scoped** → surfaces as `status: blocked` / inferred (§H), never an
  infinite re-exhaust loop.
- **Tools.** Broad (Bash, Read/Edit/Write, Grep/Glob, Skill, Task tools, ToolSearch/MCP, Agent) minus
  `AskUserQuestion`/`ExitPlanMode`.

### C. The contract — `fork_key`, two payloads, and a fully-specified validator

**`fork_key` (the dedup/awareness/override linchpin — rev2 left it undefined).**
`fork_key = sha256( member-id + '\0' + canonicalForkSubject )`, computed **deterministically in ONE
tested helper** so the SAME fork yields the SAME key on every (re)dispatch. `canonicalForkSubject` is
a STRUCTURED string, never free prose: for a blast-radius/symbol fork it is the exact symbol/argument
passed to `detect-fork-blast-radius.mjs`; for a `design-approval` it is `"design-approval:" +
<design-slice-id>` (the member's design slice, stable across re-dispatch). [plan: finalize the exact
canonicalisation + the helper's home — extend `member-summary.mjs` or a sibling `fork-key.mjs`.]
Every decision entry carries `fork_key`; `member-summary.mjs` AND `appendDecision` **require + reject
entries lacking** a non-empty `fork_key` (mirroring the existing `member` check).

`member-summary.mjs` invocation contract (to `runstate.mjs`'s standard):
- **Input.** The orchestrator writes the subagent's verbatim final message to a temp file;
  `node member-summary.mjs parse <file>`.
- **Extraction.** The operative payload is the **LAST** fenced ```json block whose object has a
  `kind`; **earlier `kind`-bearing fences are ignored as narrative** (so a quoted/example payload is
  not fatal). Parse-failure is reserved for: zero `kind`-bearing blocks, malformed JSON,
  schema-invalid, or two *different* `kind`s both plausibly operative (genuine ambiguity).
- **Exit-code table:** `0` valid `needs-decision`; `1` `member-summary`/`shipped`; `2`
  `member-summary`/`blocked` — **emitted whenever `status: blocked` is present even if
  `blocked_reason` is missing** (soft: default it to `"unspecified"`, so blocked never misroutes to
  parse-failure); `3` parse-failure (clean stderr).
- **Closed-schema validation** of both payloads (unknown keys rejected; enums checked; `fork_key`
  required on each decision/needs-decision).

**Loop bounds (two SEPARATE counters — rev2 conflated them):**
- **Repair counter:** ≤2 *consecutive* exit-3 parse-failures → floor. A valid payload resets it.
- **Progress guard:** the `needs-decision`↔`SendMessage` loop floors only on **non-progress** — a
  *repeated identical `fork_key`* or consecutive parse-failures — **never on legitimate distinct
  forks**. Interactive mode bubbles every fork (§E), so a complex member may have many distinct forks;
  that is fine and must not be force-floored.
- **Floor-pause / cap option set (was undefined):** `retry-member-fresh` / `split-member` /
  `abort-epic`.

**`MEMBER-SUMMARY`** (terminal): `{ kind, member, lane, status:shipped|blocked, validation_gate
(CONCISE — never raw logs), commits[], decisions[]{decision,options,chosen,rationale,rejected,fork_key},
blocked_reason (iff blocked) }`. `decisions[]` here is **informational** (for the progress note); the
**durable** record is run-state, written at resolution time by whichever actor resolved the fork (§D).

**`NEEDS-DECISION`** (parked): `{ kind, member, reason:design-approval|floor:<which>|bounded-effort-
exceeded|catch-all, question, deliberation (for design-approval — the brainstorming summary, §I),
options[]{label,description,recommended}, fork_key, blast_radius }`. Also the unattended "fail the
run" signal.

### D. E4 (member loop) + E5 (decision handling)

**E4.2 dispatch + parse loop:** spawn the subagent synchronously, passing variable inputs + **only the
minimal pre-decided set for this member — a list of `(fork_key, chosen)` pairs** (NOT full entries, to
keep the dispatch payload bounded). Write the returned message to a temp file; branch on exit code:
`0` → §E5 (resolve, **persist the ruling at resolution time**, then `SendMessage` the ruling, re-parse);
`1` → emit a one-line progress note; **then** (ordering invariant) consult `epic-members.mjs`;
`2` → §H; `3` → repair (≤2) then floor.

**Durable decision persistence (closes mid-fork-crash loss + summary-undercount):**
- **Floor/override** rulings: the **orchestrator** appends to run-state at resolution time (before SendMessage).
- **`--auto` non-floor** forks: the **subagent** appends to run-state at resolution time (it runs in
  the worktree; calls the helper). So run-state is the COMPLETE durable record regardless of whether
  the summary is later dropped/garbled. The summary's `decisions[]` is informational only.
- **Dedup + override (corrected — must not drop an override):** `appendDecision` no-ops only on a
  collision of `(member, fork_key)` for a NON-superseding entry — this kills the accidental
  double-log. An **override entry carries `supersedes: <prior-index>`** and is **EXEMPT from dedup**
  (it intentionally re-uses the superseded `fork_key`). The log stays append-only-with-supersede
  (never edit/remove a prior entry).

**Decision-aware re-dispatch:** the worker treats any `(fork_key, chosen)` passed in as **pre-decided
— and for an override it ADOPTS the imposed `chosen` value**, not merely "no re-ask." Closes
cold-resume-mid-fork and the override re-dispatch.

**Drainable ordering invariant:** do NOT consult `epic-members.mjs` for a member until its summary is
parsed (a member commits `status: shipped` mid-turn; advancing before the summary would skip its progress note).

**E5 decision handling:** interactive → AskUserQuestion (validate the payload's `(Recommended)`
marking + `reason` before rendering — they come from a subagent) → SendMessage. `--auto` → non-floor
never reaches the orchestrator (subagent self-resolves + self-persists); **floor** → AskUserQuestion →
SendMessage. `type:design` approval → always bubbled (`deliberation` carried, §I).

**Floor enforcement — the honest model (rev2's correction was itself wrong):**
`settings.local.json` carries a large `permissions.allow` list, so the harness's default prompting is
**NOT** a reliable mechanical backstop — many Bash ops (including some git) auto-proceed unprompted,
and a dispatched subagent's permission inheritance is unverified. Therefore the floor's REAL gates are:
1. the **tested `detect-fork-blast-radius.mjs`** (mechanical) for scope-boundary forks;
2. an explicit **irreversible-action checklist** the worker matches BEFORE acting (`git push --force`,
   `branch -D`, `reset --hard` on shared, destructive deletes, out-of-repo, real-money, staging/prod)
   and bubbles up as `floor` — this is the load-bearing gate for destructive ops, NOT prompting;
3. AskUserQuestion-exclusion (subagent can't self-approve a pause) — pending spike.
**Follow-up (out of scope here):** install a `permissions.deny` / `PreToolUse` hook for the
irreversible set so unattended runs have a TRUE mechanical gate. §Risk adds spike items to measure what
a destructive/unlisted Bash actually does inside the subagent + whether it inherits `permissions.allow`.

### E. E6/E7 — consistency audit (advisory) + override

The orchestrator is the only actor with the cumulative decision log, so it runs a **pre-done,
SUMMARY-ONLY** cross-member consistency pass (a scoped helper/grep returns new exported symbols per
member + duplication flags — never the raw diff in the orchestrator). **This is an explicit HEURISTIC
model-judgment pass, not a tested detector** — its failure mode is "may miss an inconsistency"
(acceptable; additive). Any re-open is **user-confirmed in BOTH modes** (AskUserQuestion; in `--auto`
re-opening a shipped member is a floor action). An override appends a `supersedes` entry (the NEW
imposed value), re-opens the member, re-dispatches decision-aware (worker ADOPTS the value) → HEAD
moves → `e2e-fresh` invalidates → return to E6.

### F. Worker (`/backlog-next` epic-member mode) delta + reconciliation

- **Add to "Floor (self-contained)":** when running as the `epic-member-worker` subagent, do NOT call
  `AskUserQuestion`; surface decisions via a `NEEDS-DECISION` end-of-turn payload; treat passed-in
  `(fork_key, chosen)` as pre-decided (adopt an override's value); in `--auto` self-resolve non-floor
  forks AND append each to run-state at resolution time (with `fork_key`).
- **`status: blocked` discriminating rule:** emit `status: blocked` ONLY when **no user ruling within
  the member could unblock it** (missing external precondition; or mis-scoped/too-large → needs a
  split). If a user *choice* could unblock → emit `NEEDS-DECISION` instead. (`blocked` is not a
  member-execution fork, but it does require an epic-level disposition, §H.)
- **Rescind/rewrite** the now-contradictory "Floor (self-contained) … pause via AskUserQuestion (a
  prose pause is a skill violation)" clause and **reconcile the stale inline-execution assertions**
  (worker `SKILL.md`: the "When to invoke" + epic-member prose hard-coding inline Skill-tool loading
  as THE model, and the epic-member guard's inline-load trigger) to "the orchestrator dispatches epic
  members as `epic-member-worker` subagents."
- Execution logic otherwise unchanged.

### G. Concurrency / re-entrancy — atomic lock, NO heartbeat (rev2's heartbeat was unworkable)

The orchestrator is blocked in the synchronous `Agent` call for the whole member turn, so it **cannot
refresh a heartbeat** — rev2's `{session-id, heartbeat-ts}` lock would go stale during normal
operation. Replace it:
- **Atomic acquire:** the resume gate creates `<git-common-dir>/backlog-next-epic-<id>.lock` with an
  exclusive create (`writeFileSync(path, …, {flag:'wx'})`) recording `{session-id, pid, start-ts}`.
  Winner owns it; a loser that finds an existing lock goes to **refuse-and-ask** (resume-vs-abort) —
  **no auto-reclaim on a staleness timer** (kills the TOCTOU race).
- **Liveness without heartbeat:** on finding an existing lock, check the recorded `pid` — provably
  dead → offer reclaim (user-confirmed); alive/unknown → refuse-and-ask. [plan: pid-liveness check.]
- **Lifecycle vs E8:** release the lock at the **E8.1 STOP** (the run genuinely yields to the user's
  merge) and on clean exit; **re-acquire atomically** on a later resume / the post-merge tail / a
  "keep iterating" re-entry. A crash leaves a stale lock → the next resume's pid-liveness check
  handles it. The lock is NOT held across the unbounded human-merge window.
- **Intra-session: no concurrency by construction** (synchronous foreground dispatch; the orchestrator
  never touches the shared `.git/index` during a live subagent turn — its own git ops run only between
  members). §Risk item 9 empirically confirms `Agent()` blocks end-to-end + the subagent's mid-turn
  commit is visible the instant control returns.

### H. Migration guard + `status: blocked` end-to-end + context-exhaustion

- **Tier-1 as the spike-gated fallback MODE (Goal 2).** Not a per-member runtime toggle: if the §Risk
  spike fails, Tier-1 (unconditional `/clear`) is the chosen mode; on success the `/clear` prose is
  dormant (kept as labelled documentation) until removed after 3 successful Tier-2 epics by a
  follow-up item. This names the trigger the review flagged as missing.
- **`status: blocked` routing.** Orchestrator routes a blocked summary via **AskUserQuestion** (not a
  prose halt): `abort-epic` / `file-follow-up-and-skip` / `split-and-retry`.
- **Context-exhaustion (can't self-report cleanly).** An exhausted subagent may fail to emit a clean
  `blocked` payload. So the orchestrator **INFERS** it: a member that exit-3's AND still exit-3's
  after the ≤2 repair turns (cannot even re-emit a payload) is treated as **context-exhausted /
  too-large** → routed to `split-and-retry`, NOT a generic floor. (Splitting a too-large member aligns
  with backlog discipline: members must be context-sized.)

### I. Interactive-mode observability (keep both-modes + mitigate)

Both modes isolate members; a watching non-`--auto` user no longer sees the member's work scroll by.
Mitigations: the `design-approval` payload MUST carry `deliberation` (the brainstorming summary +
option reasoning) so a design is approved with its context; the per-member progress note names lane +
key files/services + auto-resolved decisions. Acknowledged cost: reduced live visibility/interjection
mid-member vs today (a user wanting full interactive drive uses standalone `/backlog-next`).

### J. E8 PR-body + `e8` lifecycle

- **Per-member attribution is durable** (rev2 had none): the epic-member worker **prefixes every
  commit subject with `[<member-id>]`** (or an `Epic-Member: <id>` trailer). E8 groups `git log
  origin/main..HEAD` by that tag for the per-member summary; the decision section comes from run-state
  `decisions[]`. Both are durable → E8 composes on a fresh-session resume.
- **`e8` lifecycle.** Add additive `runstate.mjs clear-e8 <id>`. **"Keep iterating" is a DISTINCT E8
  branch** that does NOT run the E8.2 worktree-removal and does NOT set `e8`: it leaves the worktree
  attached, re-acquires the lock if needed, and re-enters E4. Only the hand-off branch removes the
  worktree + sets `e8`; `clear-e8` + worktree re-attach are needed only on the post-merge tail or a
  crashed-resume.

## Decisions & alternatives rejected

| Decision | Choice | Rejected |
|----------|--------|----------|
| Dispatch scope | both modes use subagents (+ §I mitigation) | `--auto`-only (interactive still exhausts) |
| Mechanism | fresh `epic-member-worker` subagent | `fork` (inherits context) |
| Wrapper-contract home | versioned custom agent type (spike-verified) | ephemeral dispatch prose |
| Resume after `needs-decision` | keep subagent alive + `SendMessage`; persist at resolution; decision-aware re-dispatch as cold fallback | fresh re-dispatch as primary (re-work) |
| `--auto` non-floor site | inside the subagent, persisted there | bubble every fork (re-injects context) |
| Override | scoped advisory pre-done audit + user-confirmed re-open w/ `supersedes` | free-floating override · none |
| Tier-1 fate | spike-gated fallback mode, removed after 3 Tier-2 epics | delete on one dry-run · keep as per-member toggle |
| Concurrency | atomic `wx` lock + refuse-and-ask + pid-liveness | heartbeat (unrefreshable under sync dispatch) · auto-reclaim (TOCTOU) · none |
| Floor for destructive ops | mechanical blast-radius gate + irreversible-action checklist (+ deny-hook follow-up) | default permission-prompt backstop (defeated by `permissions.allow`) |

## Primary risk — EXPANDED spike (go/no-go, BEFORE any rewrite / Tier-1 mode-selection)

1. **SendMessage continuation** end-to-end (spawn → payload → AskUserQuestion → `SendMessage(id,ruling)` → resumes w/ context).
2. **Custom agent type honored** (`subagent_type:"epic-member-worker"` resolves the file).
3. **Tool-allowlist exclusion ENFORCED** (AskUserQuestion/ExitPlanMode genuinely uncallable) — else honor-system fallback + re-evaluate the type.
4. **Broad allowlist granted** (Bash/Skill/Task).
5. **Agent nesting** (may the subagent spawn read-only `Explore`?).
6. **Context-isolation proxy** — orchestrator per-member delta (turn-count + payload bytes) bounded & **independent of files-touched** (trivial vs file-heavy member) AND **independent of distinct-fork count beyond a fixed per-fork payload** (a multi-fork member's orchestrator delta scales only by #forks × fixed payload, with no member internal work leaking).
7. **Permission inheritance** — does a dispatched subagent inherit `settings.local.json` `permissions.allow`?
8. **Destructive-Bash behavior inside the subagent** — a destructive-but-unlisted vs benign-unlisted Bash call: proceeds / blocks / fails? (Validates §D's floor model; if destructive auto-proceeds, the irreversible-action checklist + a deny-hook follow-up are mandatory before any unattended use.)
9. **`Agent()` blocking semantics** — confirm it blocks the orchestrator end-to-end and the subagent's mid-turn commit is durably visible the instant control returns (validates §G intra-session safety).

**Fallback if 1 fails:** fresh re-dispatch from disk-persisted rulings (first-class via §D). **If 3
fails:** honor-system bubble-up; re-evaluate the custom type. **If 6 fails:** the design does not meet
its goal → reconsider before proceeding. **If 8 shows auto-proceed:** the floor is not safe for
unattended until the deny-hook follow-up lands.

## Deferred follow-ups

- **System-wide backlog-system test harness** (own item) — prose orchestration has no automated
  coverage; push deterministic decisions into tested `.mjs` + an optional fixture-epic rehearsal.
- **`permissions.deny` / `PreToolUse` hook** for the irreversible-action set — the only TRUE
  mechanical floor gate for unattended runs.
- **Remove the Tier-1 `/clear` fallback** after 3 successful Tier-2 epics.

## Verification

- `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` green — new `member-summary.test.mjs`
  (both kinds; extraction take-last + narrative-fence-ignored + genuine-ambiguity ⇒ exit 3; exit table
  0/1/2/3; **blocked-without-reason ⇒ exit 2**; `fork_key`-required rejection); +
  **`fork_key` determinism test** (same structured inputs ⇒ same key across simulated re-dispatch); +
  `runstate.test.mjs` additions (`clear-e8`; `appendDecision` dedups `(member,fork_key)` non-superseding,
  **but appends a `supersedes` override**).
- **The expanded §Risk spike passes** (all 9) or the documented fallback is adopted — before the rewrite.
- **Path coverage** in a 2–3-member dry-run: happy path (transcript shows only one-liners + decision
  log, no file-dumps); crash/resume mid-fork (no re-ask); **override (worker ADOPTS the imposed value;
  dedup does NOT drop the `supersedes` entry)**; blocked (AskUserQuestion, not prose); parse-failure
  (≤2 repair then floor); **inferred too-large** (repeated exit-3 → split, not generic floor);
  **multi-fork interactive member NOT force-floored**; concurrency (`wx` lock contention → refuse-and-ask;
  crashed-session pid-dead → reclaim).
- **Context-isolation proxy** — orchestrator per-member turn-count + payload bytes bounded &
  independent of files-touched AND scaling only as #forks × fixed payload.
- The orchestrator `SKILL.md` keeps E4.5 `/clear` only as a labelled spike-fallback; the worker
  `SKILL.md` inline assertions are reconciled; commits carry `[<member-id>]`; the `2026-06-21` spec
  carries a correction note pointing here.

## Revision log

- **rev3 (2026-06-23)** — after a focused re-review (closure: 10/19 closed, 9 partial, 0 regressions;
  but the hardening introduced new blockers). Fixed: **`fork_key` defined** (deterministic, one helper,
  structured inputs, required+validated); **§G lock redesigned** (atomic `wx` + refuse-and-ask +
  pid-liveness, no heartbeat, lifecycle vs E8.1) — closes the heartbeat-blocker + TOCTOU + merge-window
  hold; **floor model corrected** (`settings.local.json` allow-list defeats prompt-backstop →
  mechanical blast-radius + irreversible-action checklist + deny-hook follow-up) + spike items 7-9;
  **`appendDecision` dedup exempts `supersedes` overrides** + honest "behavior change, not schema
  change" framing; **mode-aware loop bounds** (consecutive-non-progress, not distinct forks) + split
  repair counter + floor option set; **subagent persists non-floor decisions at resolution time** +
  minimal `(fork_key,chosen)` dispatch payload; **`status:blocked` discriminating rule + inferred
  too-large**; **extraction take-last (narrative fences ignored)**; **blocked-without-reason ⇒ exit 2**;
  **E8 `[<member-id>]` commit attribution + distinct keep-iterating branch**; consistency audit
  reframed advisory; Tier-1 migration-guard trigger named; strengthened Verification.
- **rev2 (2026-06-23)** — hardened after a 101-agent deep review (see git history).
- **rev1 (2026-06-23)** — initial design from the brainstorming Q&A (5 forks).
