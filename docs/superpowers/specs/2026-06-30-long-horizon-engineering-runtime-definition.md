# The Long-Horizon Engineering Runtime — A Product Definition

> **Status:** definition + naming (brainstorm output). Defines *what the product is* and *what it
> solves*; defers *how it is built* (realization taxonomy, adapter contract, learning-loop closure)
> to a follow-on design.
> **Date:** 2026-06-30
> **Product name:** *TBD* — referred to here as **the Runtime**.
> **Provenance:** extracted from the Nestfolio "backlog system" (the `backlog-*` skill suite under
> `.claude/skills/`), which grew through ~9 design specs into a de-facto runtime for long-lived
> autonomous software engineering. Sparked by, and corrects, `chatgpt-response.md` at the repo root.
> Terms are deliberately **plain and standard — no governing metaphor.**

---

## 1. What it is

**One sentence.** *The Runtime is a portable control plane that gives a stateless coding agent the
executive functions it cannot hold on its own — durable memory of intent, a sense of priority, the
project's invariants, crash/`/clear` recovery, and proof-of-done — so a developer can launch
long-running, almost-autonomous work on an enterprise-grade codebase and trust it stays consistent
and on-priority across sessions, models, and interruptions.*

**Category.** A *control plane for long-horizon agentic software engineering* — the layer between a
developer and a coding agent (Claude Code today, another model/harness tomorrow) that makes
multi-session, semi-autonomous work on a large codebase **safe, consistent, and correctly
prioritized.**

**Who it's for.** A developer working *with* a coding agent on a real, large, multi-domain system —
where the work outlives any single context window, the codebase has invariants that must not
silently break, and there is always more to do than time (so *what's next* matters as much as *how*).

**The core thesis — the fungible executor.** The Runtime's real product is a **disposable
executor.** "Model-portable" (Claude → another model) and "run-continuous" (survives `/clear`,
crashes, context exhaustion) are the **same property** — executor statelessness. The Runtime exists
to hand a fresh, amnesiac executor everything it needs on each wake, and to refuse the two moves that
break that property (see §8).

---

## 2. What it solves — seven named failure modes

| # | Failure mode | The Runtime's answer |
|---|---|---|
| 1 | **Amnesia** — intent, decisions, and lessons evaporate across sessions/clears/crashes | externalized, git-native durable state (the disposable-executor model) |
| 2 | **Drift** — invariants silently rot; rules live in someone's head, enforced "socially" | invariants as **checks, not conventions** |
| 3 | **Distraction** — every session surfaces new findings; the work fragments and nothing closes | file-and-continue + one active workstream + aggregation into epics |
| 4 | **Priority blindness** — "what's next?" is answered by recency or vibes | a *derived*, ranked, computed-at-read-time priority surface |
| 5 | **Unsafe autonomy** — "just let it run" collapses into something irreversible | bounded autonomy with a **human-confirmed floor** |
| 6 | **Unproven done** — "shipped" with no evidence; green that ran zero tests | prescriptive validation gates + a self-eval harness with teeth |
| 7 | **Model / harness lock-in** — everything baked into one model's prompt | a model- and harness-agnostic protocol; the executor is fungible |

These map 1:1 onto the design laws and scars in §8 — which is why this is a real product, not a wish.

---

## 3. The shape — a closed loop

The Runtime both **feeds** and **drains** its own queue:

```
detect → file → prioritize → fix → prove → learn → (sharper) detect
```

- **detect** — the **watch engine** runs checks on triggers and emits findings.
- **file** — **intake** turns findings into items (standalone / epic member / theme).
- **prioritize** — the **planner** decides what's worked next (rank + read-time impact).
- **fix** — the **execution engine** (worker + orchestrator) runs the item.
- **prove** — **gates** validate at item boundaries; only the **floor** stops for the human.
- **learn** — a shipped fix can mint a **lesson** → a new **invariant** → a new permanent **check**.

Two engines, joined by the queue, both informed by the knowledge store. The loop closes because
knowledge flows *backward*: every lesson hardens a future check, so **the system gets monotonically
harder to break over time.**

---

## 4. The core mechanism — the *check* is the universal atom

A **check** is one deterministic-or-judgment test of a single consistency property. The decisive
design choice: a check is written **once** and runs in three **trigger contexts**:

| Context | When the check runs | Plain name |
|---|---|---|
| at an item boundary | when an item starts/ships | a **gate** |
| on a trigger/schedule | manual · scheduled · on-commit/merge/CI | an **audit** |
| as an always-true rule | continuously asserted | an **invariant** |

**Consequences.**

- **"Keeping consistency" (proactive) and "proof-of-done" (reactive validation) are the same
  machinery**, not two subsystems — one library of checks, three contexts.
- It is the plain, honest answer to the seductive "first-class Constraint" idea: **a constraint is
  simply a registered check** — an executable test that either passes or files a finding — *not* a
  stored note that drifts. The same move covers **dependencies**: a precondition is just a check
  (see §8 cautions).
- One thing to build, test, and port.

---

## 5. The component map

| Part | Job |
|---|---|
| **queue** (index + items) | the shared work list both engines touch |
| **watch engine** | runs checks on triggers → emits findings |
| **intake** | files findings as items (standalone / epic / theme) |
| **planner** | `next` + `rank` + read-time `impact` — decides what is worked |
| **execution engine** (worker · orchestrator) | start → route → validate → ship |
| **gates** | checks run at item boundaries (the *prove* step) |
| **invariant registry** | the always-true checks the watch engine enforces |
| **knowledge store** | lessons · decisions · dossiers — feeds *what to check* and *how to decide* |
| **the floor** | the human-approval boundary for irreversible / outward-facing acts |
| **eval harness** | proves the Runtime itself works (regression on its own procedures) |

---

## 6. The vocabulary (plain-terms glossary)

Standard terms, no metaphor. `(was …)` marks a rename from the current Nestfolio system to stay
plain; `(or …)` marks a live alternative.

**Roles** — **developer** (you; final authority on irreversible calls) · **agent** (the LLM that does
the work; stateless and fungible) · **runtime** (the product itself; name TBD).

**Units of work** — **item** `(or work item / task)` (the atomic unit of tracked work) · **type**
(bug · refactor · feature · design · spec · tooling · infra · chore · epic) · **epic** (a group of
items sharing one outcome or root cause) · **member** (an item inside an epic; role **required**
`(was core)` or **incidental** `(was captured)`) · **finding** (an observation that may yield zero,
one, or many items — *not itself work*).

**State** — **active** (being worked now; at most one — the *single-active* rule) · **queued**
(scheduled and ranked) · **later** `(was parking)` (tracked but unscheduled) · **shipped** `(or
done)` (delivered, with evidence) · **dropped** (abandoned).

**Priority** — **rank** (explicit order among queued) · **impact** (priority computed at read time,
never stored) · **next** (the operation that decides what to work on).

**Knowledge** — **lesson** (a hard rule learned from a failure — "never again") · **decision** (a
recorded design choice; append-only) · **dossier** `(or note)` (durable topic knowledge outliving
any one item).

**Execution** — **pre-checks / post-checks** `(was preflight/postflight)` (hard gates at
start/finish) · **pick → start → route → validate → ship** (`start` was `adopt`) · **lane** (the
complexity track: doc · simple · complex) · **gate** (a hard check that must pass) · **run state**
(the durable, resumable record of an in-flight run) · **resume** (continue from disk) · **auto mode**
(unattended execution, bounded by the floor) · **the floor** (decisions that always need the human).

**Watch engine** — **check** (one consistency test) · **audit** (a runnable sweep of checks over a
**scope**) · **trigger** (manual · scheduled · event) · **invariant** (an always-true property) ·
finding **kinds**: **drift** (an invariant just broke) · **inconsistency** (two sources disagree) ·
**gap** (missing test/consumer/doc/owner) · **staleness** (a derived artifact lags its source).

**The parts** — **index** · **linter** · **intake** `(was backlog-add)` · **worker** · **orchestrator**
· **grouping pass** `(was backlog-themes)`; the four layers: **procedure** (steps) · **lessons**
(knowledge) · **helpers** (tested scripts) · **eval harness** (regression suite).

**Principles** — single-active · derive-don't-store · file-and-continue · evidence-before-done ·
stateless-executor · the-human-floor · harness-agnostic-core/maximal-adapter.

---

## 7. Form factor — harness-agnostic core, harness-maximal adapter

The Runtime is defined as a **model- and harness-agnostic protocol** (the data model, the check
registry, the state machine, the loop) with a **thin harness adapter**, shipped with a **Claude Code
reference implementation first.** Portable across **projects and agents**.

The guiding rule is **progressive enhancement, not lowest-common-denominator.** The core depends on
small **capability interfaces** — *execute a task · fan out parallel work · ask the human · run on a
trigger · run a sub-procedure* — and knows nothing about any harness. The **Claude Code adapter binds
each capability to the richest available feature**; another harness binds the same capabilities to
its own, or degrades gracefully:

| Capability | Claude Code binding (maximal) | If a harness lacks it |
|---|---|---|
| per-task procedure | **superpowers** skills (brainstorming/TDD/debugging/finishing) | inline steps, or host's skills |
| fan-out | **subagents / agent teams** (parallel checks, audits, research) | run sequentially |
| watch-engine batch | **Workflow / ultracode** (`parallel`/`pipeline` audits + verify) | sequential audit loop |
| trigger | **hooks / cron** (on-commit/merge/CI, scheduled) | manual triggers only |
| ask the human (the floor) | **AskUserQuestion** | the `<<HARNESS-PAUSE>>` sentinel (proven in the eval harness) |

**You give up nothing** — the reference adapter uses every Claude Code feature fully; the protocol
only keeps the *core* from *depending* on them, so the executor (model **and** harness) stays
fungible. The seams already exist (worker/orchestrator split, Skill-tool routing, eval stubs), so
this *names* an existing discipline more than it adds one. **Derived rule:** *subagents for fan-out,
never to hide the interactive worker* (the Tier-2 scar, §8).

---

## 8. Design laws and hard-won cautions

**Laws (the spine — preserve these).**

1. **Single-active** — at most one item, and at most one delivery epic, in progress at a time.
2. **Derive, don't store** — store only irreducible *decisions* (status, rank, type, pointers,
   done-criteria); compute everything else (priority/impact, membership, rollups, dates) at read
   time.
3. **Deterministic helpers for the mechanizable** — anything that can be a tested script is one, not
   prose.
4. **The human floor** — irreversible / outward-facing acts always require explicit human approval,
   surfaced as a real choice, even in auto mode.
5. **Evidence before done** — nothing is "shipped" without proof; *exit 0 ≠ pass*.
6. **Stateless executor** — the agent is disposable; all state lives on disk; a `/clear` is free.
7. **Harness-agnostic core, maximal adapter** — progressive enhancement (§7).

**Hard-won cautions — open directions, not bans.**

These are *scars*, not prohibitions. Each marks a direction that failed **once, via a specific bad
approach** — not a direction that is impossible. Keep the warning vivid (re-learning these costs a
lot); follow the positive constraint; revisit the frontier when its precondition is met. Both
collapse into corollaries of the laws above, so neither adds a new prohibition.

- **Relationships between items (dependencies, priority, a knowledge model).**
  - *Scar.* Three attempts at stored relational state — `blocked_by`, `depends_on`, a stored
    `severity` field — all drifted, because each was **hand-maintained state that nothing
    re-validates** (write-only truth that rots).
  - *Narrow lesson.* The failure was the *mechanism* (hand-drawn, hand-maintained edges), not the
    *thing represented*. Dependencies are real, and a single-parent tree + total-order `rank`
    actively *loses* that partial-order information.
  - *Positive constraint.* **Represent relationships as derivations or checks, never as
    hand-maintained stored edges.** A dependency is a *precondition*, a precondition is a **check**,
    and a check is the atom of §4 — `B needs contract X` is a check evaluated against the code, not an
    arrow to another item, so it cannot drift. Under this constraint, derived/checked dependencies are
    not merely allowed — they *recover* the expressiveness the tree throws away. (This is the honest
    answer to ChatGPT's "first-class Constraint": it becomes a registered check, not a stored note.)
  - *Frontier.* A read-time-derived dependency/precondition view — and a derived, never hand-stored,
    knowledge projection — is open to build whenever it earns its keep.

- **Isolating work in sub-contexts (subagents / agent teams).**
  - *Scar.* Running the execution worker as an isolated subagent ("Tier-2") was built, merged, and
    **reverted within hours** — context isolation leaked through nested agents, and it stripped the
    developer's ability to interject and watch.
  - *Narrow lesson.* Two *separable* faults: (a) *unbounded* nesting dumped sub-sub-agent transcripts
    back into the parent (a bounded, summary-only boundary does not — the research fan-out behind this
    very document leaked nothing); and (b) it isolated the **wrong thing** — the decision-bearing,
    collaborative spine.
  - *Positive constraint.* **Isolate decision-free, breadth-shaped work (fan-out — in fact mandate
    it); keep decision-bearing, collaborative work inline and visible** (the §7 rule). Any isolation
    boundary must return summaries, not transcripts, and must preserve human-reachability for the work
    it carries.
  - *Frontier.* The spine stays inline *today* because the harness cannot yet give an isolated worker
    a visible, interruptible channel — not because it is eternally impossible. Revisit the moment a
    harness can surface an isolated worker's reasoning and its floor-pauses to the developer.

---

## 9. What this is NOT

- **Not a backlog tool / PM SaaS.** The queue is the visible surface; the product is the runtime
  beneath it.
- **Not an agent framework.** It sits *above* per-task agent skills (it orchestrates them), not
  beside them.
- **Not a *hand-maintained* knowledge base / graph.** Knowledge is checks (executable) +
  lessons/decisions/dossiers (append-only records); any relational view — dependencies, a knowledge
  projection — is *derived or checked*, never a hand-maintained stored model that drifts (§8).
- **Not a planner that stores priorities.** Priority is computed at read time and confirmed by the
  human; it is never a stored, stale field.

---

## 10. Open questions (next phase)

1. **Product name** — TBD (plain, standard; chosen later).
2. **Realization taxonomy** — how each component becomes one of the end-goal artifact types:
   *rules* (checks) · *skills* (procedures) · *workflows* (orchestration) · *agents* (scheduled
   watches / the worker) · *helpers* (deterministic scripts).
3. **Portability adapter contract** — the capability interfaces (§7) specified, with Claude Code
   bindings and graceful-degradation rules.
4. **Learning-loop closure** — today the lesson → check path is human-stitched; how far to automate
   *lesson → registered check → eval scenario*.
5. **The deep fork** — is the spine the **item** (work-centric, today's shape) or the **check**
   (consistency-centric, where work is just how a failing check gets resolved)? §4 leans toward the
   check being the atom; whether it becomes the organizing *spine* is the central next decision.
