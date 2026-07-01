# The Long-Horizon Engineering Runtime — Product Vision

> A control plane that lets a developer launch long-running, almost-autonomous engineering work on a
> large codebase — and trust it to stay consistent, on-priority, and provably done across sessions,
> models, and interruptions. Its defining capability: **every shipped fix can mint a permanent,
> enforced check — and every check is curated for its whole life at the human floor — so the codebase
> gets monotonically harder to break against the properties you still intend to hold.**
>
> *Working name: the Runtime.*

---

## 1. What it is

**In one sentence.** The Runtime is a portable control plane that gives a stateless coding agent the
executive functions it cannot hold on its own — durable memory of intent, a sense of priority, the
project's invariants expressed as executable checks, a lifecycle that keeps those checks honest,
crash/restart recovery, and proof-of-done — so a developer can launch long-running, almost-autonomous
work on a large codebase and trust that it stays consistent and correctly prioritized across sessions,
models, and interruptions.

**Category.** A *control plane for long-horizon agentic software engineering*: the layer between a
developer and a coding agent that makes multi-session, semi-autonomous work on a large system **safe,
consistent, and correctly prioritized.**

**Who it is for.** A developer working *with* a coding agent on a real, large, multi-domain system —
where the work outlives any single context window, the codebase has invariants that must not silently
break, and there is always more to do than time (so *what's next* matters as much as *how*).

**Grounded, not aspirational.** The Runtime is the generalization of a real, lint-enforced reference
implementation already managing a 32-service system: a git-native backlog with a single-active
discipline, an epic orchestrator, drift-checking build targets, a self-grading eval harness, and a
knowledge store of lessons. The forward machinery *runs today*; the backward edge (§9) is the part it
grew toward and does not yet fully close. This vision names what that system is becoming — and is
honest (§3, §9) about which half is proven and which half is the frontier.

**The core thesis — the fungible executor.** The Runtime's real product is a **disposable executor.**
"Model-portable" (swap one model for another) and "run-continuous" (survive a context reset, a crash,
context exhaustion) are the *same property*: executor statelessness. The Runtime exists to hand a
fresh, amnesiac executor everything it needs on each wake — and to refuse the two moves that would
break that property (§13). The agent does the work; the Runtime holds the state, the priority, the
invariants, and the proof.

---

## 2. The problem — seven failure modes

Long-horizon agentic engineering fails in seven recurring, nameable ways. Each is a first-class
problem the Runtime answers *structurally* — with a mechanism, not an exhortation.

| # | Failure mode | The Runtime's answer |
|---|---|---|
| 1 | **Amnesia** — intent, decisions, and lessons evaporate across sessions, resets, and crashes | externalized, git-native durable state; the executor holds nothing |
| 2 | **Drift** — invariants silently rot; rules live in someone's head, enforced "socially" | invariants are **checks, not conventions** — executable, and they fail loudly |
| 3 | **Distraction** — every session surfaces new findings; work fragments and nothing closes | single-active (lint-enforced) **+ a scope-gate check (the active item's diff ⊆ its declared scope)** + file-and-continue intake into epics |
| 4 | **Priority blindness** — "what's next?" is answered by recency or vibes | a *derived*, ranked, computed-at-read-time priority surface |
| 5 | **Unsafe autonomy** — "just let it run" eventually does something irreversible | bounded autonomy with a **human-confirmed floor** |
| 6 | **Unproven done** — "shipped" with no evidence; a green run that ran zero tests | prescriptive validation gates + a self-eval harness with real teeth |
| 7 | **Lock-in** — everything baked into one model's prompt or one harness | a model- and harness-agnostic protocol; the executor is fungible |

These map onto the design laws in §13 — which is why this is a structured product, not a wish list.
(The Runtime also introduces two failure modes *of its own* — enforcement that rots and a registry
that drifts — and answers both in §6 and §14. A product that adds a moat must own the debt the moat
creates.)

---

## 3. The thesis — a codebase that gets harder to break

Most of what a long-horizon runtime needs is, individually, a known discipline: durable resume with a
human floor, git-native memory, a ranked queue, "a constraint is an executable check." The Runtime
integrates those disciplines — but its center of gravity, the thing it is *for*, is a loop almost no
system closes:

> **A shipped fix mints a permanent, enforced check.** The "never again" you learned from a failure
> stops being a note someone has to remember and becomes a test that fails the build. Do this wherever
> a fix yields a mechanizable lesson and the codebase becomes **monotonically harder to break.**

**What "monotonic" honestly means.** Enforcement is monotone *with respect to the properties you still
intend to hold* — not "checks only ever accumulate." When you *deliberately* change a guarded
property, its guard is now wrong; it is retired or superseded at the **same floor that minted it**
(§9). So the guarantee is not an ever-growing pile of guards, but this: *every invariant you still
intend is enforced, and enforcement is curated, never left to rot.* Minting is the loop's headline;
curation is what keeps the headline true (§6, §14).

Two properties make this the defining capability rather than a feature:

- **The backward edge of the loop** (§9). Knowledge flows *backward* into enforcement: a lesson learned
  while fixing item *N* becomes a check that protects items *N+1…∞*. The forward machinery (detect,
  file, prioritize, fix, prove) is table-stakes the Runtime integrates cleanly. The backward edge — a
  shipped fix hardening the system against its own class of failure — is the product. It is also, by
  design, the *slow* edge: a deliberate, floor-gated enrichment rather than a per-item reflex. The
  forward loop is what turns every day; the backward edge is what compounds over months.
- **Enforcement-as-memory** (§7). Most knowledge systems *remember by retrieval*: they store a fact and
  inject it as context when it seems relevant. The Runtime adds a second mode for the *mechanizable
  fraction* of what it learns: a lesson that can be reduced to a pass/fail property becomes a
  registered check that runs and fails. That fraction does not remind — it enforces. The rest of a
  lesson (the *why*, the tradeoff, the judgment) stays retrieval, as it must. Enforcement-as-memory is
  not a replacement for recall; it is the subset of memory that *executes* — and it is the subset no
  passive-retrieval memory system produces. This also sidesteps self-reinforcing error: a lesson's
  force is a deterministic (or evaluation-guarded) check, not re-injected prose the model can compound
  a mistake on.

The nodes of the loop are well-understood building blocks. The **edges** — what turns one node into the
next, and especially the backward edge — are the product.

---

## 4. The shape — a closed loop

The Runtime both **feeds** and **drains** its own queue:

```
detect → file → prioritize → fix → prove → learn → (sharper) detect
                                     │        │
                                     │        └─ mint: a lesson → a new check (after ship)
                                     └─ curate: retire/supersede a guard the fix
                                        made obsolete (at the gate, before ship)
```

- **detect** — the **watch engine** runs checks on triggers and emits findings.
- **file** — **intake** turns findings into items (standalone / epic member / theme).
- **prioritize** — the **planner** decides what is worked next (rank + read-time impact).
- **fix** — the **execution engine** (worker + orchestrator) runs the item.
- **prove** — **gates** validate at item boundaries. If the fix *deliberately* changed a guarded
  property, the now-obsolete guard is *curated* at the floor (retire/supersede) **before ship** — the
  only sanctioned way past a failing guard. Only the floor stops for the human.
- **learn** — **after ship**, a fix can mint a **lesson → a new check**, sharpening the next *detect*.
  (Separately and asynchronously, the watch engine's dangling-scope detector files obsolete guards as
  ordinary findings — §6, §9.)

Two engines (watch and execution), joined by the queue, both informed by the knowledge store. The
forward path turns continuously; the backward path (learn/curate) is periodic and floor-gated. The
loop closes because knowledge flows backward: every ratified lesson hardens a future check, and every
obsolete guard is retired at the same gate — so enforcement compounds without rotting.

---

## 5. The atom — check and item

The Runtime has a **hybrid atom**, and the conversion between its two halves *is* the system:

- **A *check* is the atom of consistency** — one test of one property, held in the **check registry**
  (§6). It either passes or files a finding. A check has a **life**: it is drafted, ratified into
  enforcement, and eventually superseded or retired — all at the floor (§9).
- **An *item* is the atom of work** — a tracked unit with status, rank, type, and (optionally) an epic.
- **The loop is the conversion between them:**
  - **forward edge** — `check fails → finding → item(s)` (the watch engine + intake, §8). *Continuous.*
  - **backward edge** — two floor-gated moves (§9): at the ship gate, *curate* a guard the item's
    change made obsolete (`retire/supersede`, before ship completes); after ship, optionally *mint* a
    new check from the lesson. *Deliberate, not per-item.*

Neither atom is subordinate. The Runtime's identity is the *cycle that turns one into the other* — a
fast forward loop and a slow, deliberate backward one. That asymmetry is a feature: it is what keeps
minted enforcement rare, considered, and human-ratified rather than reflexive.

```
        ┌──────────────── knowledge store: lessons · decisions · dossiers ─────────────────┐
        │                                                                                   │
 (forward · continuous)                                                     (backward · floor-gated)
        │                                                                                   │
  check fails ─▶ finding ─intake─▶ item ─planner─▶ worker/orch ─▶ gates ──────▶ ship ──────▶ mint?
        ▲        (watch engine)                          │  guard blocks?              │  (new lesson?)
        │                                                ▼                             ▼
        │                                       floor · curate                 floor · mint
        │                                  (retire · supersede · keep)     (ratify · edit · decline)
        │                                                │                             │
        └──────── registered check (gate · audit · invariant) ◀── check registry ◀─────┴────────┘
                          "monotonically harder to break — and curated, not hoarded"
                    curate gates the ship (before); mint follows it (after) — see §9
```

**The decisive property of a check: it is written *once* and runs in three contexts.**

| Context | When it runs | What it is |
|---|---|---|
| **gate** | at an item boundary — when an item starts or ships | a hard check that must pass before work proceeds |
| **audit** | on a trigger or schedule — manual · scheduled · on-commit/merge/CI — over a **scope** | a runnable sweep that emits findings |
| **invariant** | continuously asserted | an always-true property of the codebase |

This collapses what look like two subsystems into one. **Proactively keeping the system consistent**
(audits, invariants) and **reactively proving a unit of work is done** (gates) are the *same
machinery* — one library of checks, three contexts. It is also the plain answer to the seductive idea
of a "first-class constraint": a constraint is simply a **registered check** — an executable test that
passes or files a finding — never a stored note that drifts.

---

## 6. The check registry — the core surface

The registry is the single library of checks: the one thing to build, test, and port. It is what makes
"invariants, not conventions" real; it is where the backward edge deposits what the system learns; and
it is where each check's **lifecycle** is tracked so enforcement can be curated, not merely accrued.

A **check** declares:

| Field | Meaning |
|---|---|
| `id`, `property` | the single consistency property it asserts |
| `kind` | `drift` · `inconsistency` · `gap` · `staleness` (the finding kinds, below) |
| `evaluator` | **deterministic** (a script or build target — cheap, exact) **or** **judgment** (an LLM-as-judge — expensive, calibrated) |
| `cost_tier` | drives the *default* context: cheap → per-item gate; expensive → scheduled audit or epic-batch |
| `contexts` | the subset of {gate, audit, invariant} this check actually runs in |
| `scope` | the code and dossiers it covers — feeds **scoped wake** (§7), audit scoping, and dangling-scope detection |
| `status` | `candidate` · `active` · `superseded` · `retired` — the lifecycle the floor advances (a `candidate` is a transient draft; on `decline` it is discarded, never registered — only ratified checks persist) |
| `flake_contract` | for judgment checks: calibration + an allowed-flake budget + the evaluation scenario that guards it |
| `provenance` | the lesson / decision / item that **minted** it, plus `supersedes` / `superseded_by` links — the full backward-edge history (§9) |

**The four finding kinds** a check can raise:

- **drift** — an invariant just broke.
- **inconsistency** — two sources of truth disagree.
- **gap** — something required is missing (a test, a consumer, a doc, an owner).
- **staleness** — a derived artifact lags the source it was generated from.

**Three honesty rules are built into the registry:**

- **"One check, three contexts" is a property of the *library*, not usually of a single check.** Cost
  forces most checks into *one* context — a cheap invariant as a gate, an expensive judgment as a
  scheduled audit. A check *may* span contexts and the registry allows it, but `contexts` records the
  truth rather than pretending every check is omnipresent.
- **Judgment checks are not deterministic, and the registry says so.** A judgment check carries a
  `flake_contract` and is guarded by an evaluation scenario, so calling it a "check" is earned, not
  asserted. **Deterministic-first** is the registry's standing preference: if a property *can* be
  mechanized as a script, it is — judgment is the fallback, not the default.
- **Enforcement is curated, not hoarded.** A check is not immortal. When the code legitimately changes
  a guarded property, the guard is superseded or retired (§9). `status` and the `supersedes` chain make
  that history first-class, so "the invariant set" always means *what the project still intends*, not
  *everything ever minted*.

**The registry checks itself — including for rot.** A **meta-check** asserts registry integrity: every
build target and lint rule resolves to a registry entry; every entry resolves to a runnable evaluator;
every judgment check has a `flake_contract` and an evaluation scenario. Two rot-detectors extend it:
a check whose `scope` **no longer resolves** (it guards code that is gone) is filed as a *staleness*
finding — a **retirement candidate** — and any stored knob (a `rank` weight, a lane threshold, the
floor's sensitivity) with no validating check is itself a finding. Because a check *runs*, a stale or
unrunnable check **fails loudly** — unlike a stored note, it cannot silently rot; and because the
registry hunts its own dangling guards, obsolete enforcement is surfaced for the floor rather than left
to accumulate. This is the answer to both "won't the registry become new drift-prone state?" and
"won't minted checks pile up forever?"

---

## 7. The knowledge store — and knowledge-as-enforcement

The knowledge store is git-native markdown, in three append-only kinds:

- **lessons** — hard rules learned from a failure ("never again").
- **decisions** — recorded design choices, append-only.
- **dossiers** — durable topic knowledge that outlives any single item.

Git-native, human-auditable memory is, by 2026, **table-stakes** — the Runtime keeps it but does not
pitch it as the moat. Four moves make it more than a notes folder:

- **Scoped wake** (a law, §13). A worker is handed only the dossiers and audits its item's `scope`
  reaches — never the whole store. **But global invariant gates always ride the wake:** the cheap,
  always-on checks that protect the *whole* codebase are never scoped away, or a scoped worker could
  violate a global invariant it was never shown. Scoping economizes the *retrieval* surface (dossiers,
  expensive audits); it never narrows the *enforcement* floor. A fungible, disposable executor is only
  *cheap* if each wake is *small* — context economy is the operational complement to statelessness —
  but never at the cost of the invariants that keep the system safe (§8 reconciles the cadence).
- **Enforcement-as-memory** (the distinctive move). The *mechanizable fraction* of a lesson may carry a
  **`mints:` pointer to the check it became.** That fraction is then *executable*: it has a registered
  check that fails the build, so the knowledge enforces instead of merely reminding. The rest of the
  lesson stays retrieval — enforcement-as-memory is a second mode alongside recall, not a replacement
  for it. This is the thing passive-retrieval memory does not do, and it is what makes the backward
  edge (§9) a closed loop rather than a habit. When a minted check is later retired (§9), its lesson's
  `mints:` pointer is updated in the same floor act — memory and enforcement stay in lockstep.
- **Relationships are derived or checked, never stored as hand-maintained edges.** A dependency is a
  **precondition**; a precondition is a **check** (`B needs contract X`, evaluated against the code), so
  it cannot drift the way a hand-drawn arrow between two items would. A read-time-derived dependency
  view is an open frontier (§15) — a *stored* dependency graph is not. (Some memory systems answer edge
  rot with validity windows and weight decay; the Runtime answers it with a check, because a check is
  re-evaluated against the code, not trusted until it expires.)
- **Specs, architecture docs, and flow definitions need no separate binding subsystem.** Each is either
  a dossier *or* the reference a `staleness`/`inconsistency` check validates the code against. A broken
  path or a flow that no longer matches the code is just a finding. Binding the Runtime to a project's
  own documents is checks pointed at those documents — nothing more.

---

## 8. The forward edge — watch → intake → planner → execution → gates

The forward edge turns broken consistency into prioritized, executed work.

- **Watch engine.** Runs registry checks on triggers — manual, scheduled, on-commit/merge/CI — in their
  `audit` and `invariant` contexts, and emits **findings**. Cost-tiering sets cadence, and it is the
  same tiering that reconciles scoped wake with global safety (§7): **global invariants run as gates on
  every item** (always in the wake — and invariants are *cheap by construction*: a property that is
  *continuously asserted* must be cheap to assert, so an expensive global property is modeled as an
  `audit`, never an `invariant`); **expensive checks** (a live end-to-end suite, a heavy judgment
  audit) run out-of-band and are **batched once at an epic boundary**, never per item. So a scoped
  worker is always guarded by the global invariants, and only the costly audits wait for the watch
  engine. *exit 0 ≠ pass*, but neither does "run the whole suite on every edit."
- **Intake.** Turns each finding into **zero, one, or many items** — standalone, epic member, or a new
  theme — via an epic-aware router. A finding is an *observation*, not itself work; intake is where the
  judgment "is this worth an item, and where does it belong?" lives.
- **Planner.** Decides what is worked next: `next` + `rank` + read-time `impact`. Priority is **computed
  at read time**; only `rank` — an explicit human decision — is stored (and, per law 2, itself a
  checked knob). There is no stale, stored priority field.
- **Execution engine.** Two modes. The **worker** runs a single item under a **scope-gate**: a check on
  the property *the active item's diff stays within its declared scope*, run continuously
  (`onTrigger`=commit) and at the ship gate. A diff that escapes scope files a finding and blocks the
  gate — so "don't pivot mid-flight" is enforced by a failing check, not a behavioral plea (closing
  failure mode 3). Like single-active, it is *structural* because it **bites**, not because it
  intercepts the keystroke. The **orchestrator**
  runs an epic (a shared branch, expensive checks batched once at epic pre-done, an incidental-work
  audit, a single integration). Both run behind the capability interfaces (§11). The decision-bearing
  spine stays **inline and visible** — fan-out is for breadth, never for hiding the interactive worker
  (§13).
- **Gates.** Registry checks in their `gate` context, at item start and ship. This is the *prove* step:
  nothing is shipped without the evidence its gates demand.

---

## 9. The backward edge — the learning loop

This is the moat: the surface that turns a one-time fix into permanent enforcement — and keeps that
enforcement honest as the code evolves. It has **two arms**, both floor-gated, because creating a
permanent guard and removing one are the same kind of decision: the developer's.

**Mint — after an item ships, having resolved a finding or a failure** (a post-ship enrichment):

1. **Post-checks pass.** Done is proven by the item's gates — existing, ordinary gate behavior.
2. **The worker drafts a candidate check.** Deterministic if the property is mechanizable; otherwise a
   judgment check with a draft `flake_contract` and a candidate evaluation scenario. The draft carries a
   `provenance` link to the lesson. The "never again" is now shaped as a *test*, not a note.
3. **The floor presents it.** The human chooses: **ratify · edit · decline.** The agent drafts; the
   human ratifies. This gate is the safety that self-improving loops otherwise lack — it is why minted
   enforcement cannot quietly entrench a mistake.
4. **On ratify:** the check is **registered** (`status: active`, and it gains its context), its
   **evaluation scenario is added** to the eval harness (§10), and the **lesson dossier records
   `mints:`** the check id.

**Curate — retire or supersede a guard the code has outgrown.** Two mechanically distinct triggers feed
one floor decision:

- *Synchronous — at the ship gate (blocking).* A property the item *deliberately* changed makes an
  existing guard **fail**, which would otherwise block the ship (law 5). The worker recognizes the
  failure as intended and drafts the delta — a superseding check or a straight retirement — resolved at
  the floor *before ship completes*. The default is always "make the code green"; lowering a guard is
  the exception that must be argued for.
- *Asynchronous — via the watch engine (non-blocking).* The meta-check's dangling-scope detector (§6)
  files a guard whose code is gone as an ordinary *staleness* finding; intake routes it to an item like
  any other, and its fix runs the same floor. This path never gates an unrelated ship.

At the floor, either trigger presents: **retire · supersede · keep.** Retiring enforcement is as
deliberate as creating it — you must *choose* to lower a guard, never drift past it (on `keep`, the
failure stands and the code must satisfy the check). **On retire/supersede:** the old check's `status`
advances, the `supersedes`/`superseded_by` chain is recorded, and the originating lesson's `mints:`
pointer is reconciled — enforcement history stays legible; nothing is silently deleted.

**Effect:** the watch engine enforces every *intended* property forever, and drops the ones you no
longer intend — at the same gate, with the same provenance. The codebase is monotonically harder to
break against what you still mean to hold. The §3 backward edge, mechanized through the floor.

**Deliberately not automated, and deliberately rare.** The Runtime does not auto-mint, auto-retire, or
auto-register checks; the human ratification gate is the point (enforcement is permanent, so the
decision to create *or remove* it is the developer's). And not every fix mints — most ships change no
enforcement at all. The backward edge is the system's slow, considered enrichment, not a per-item
reflex (§15.4 sets the heuristics for *when* it should fire).

---

## 10. The eval harness — the Runtime proving itself

The Runtime is itself software, and it holds itself to its own standard. The eval harness grades the
Runtime's *own* procedures — a regression suite over how it works, not over the project it manages. It
has two roles:

- **Regression on procedures.** Each Runtime procedure is a four-layer artifact — *procedure* (the
  steps) · *lessons* (the knowledge it applies) · *helpers* (tested scripts) · *eval* (its own
  regression scenarios). The teeth come from the **deterministic golden gates**; the calibrated judge
  scenarios are held to honest limits about what they can and cannot catch — self-proof is only as
  strong as its golden gates, and the harness is built to keep that layer thick.
- **Home for minted evaluation scenarios.** Every check ratified in §9 lands its evaluation scenario
  here, so the learning loop is itself regression-protected. When the harness finds its own gaps — a
  thin judge gate, an uncovered path — those become *findings the Runtime files against itself*, and run
  through the same loop as any other work.

---

## 11. Capability interfaces — the harness seam

The core depends on a small, fixed set of capability interfaces and **nothing else about its host**. A
rich host binds each interface to its most capable native primitive; a leaner host binds its own, or
degrades gracefully. The core never changes.

| Capability | What it does | Maximal binding | Graceful degradation |
|---|---|---|---|
| `execute(task)` | run one unit of work, visibly | the inline, interactive worker | inline steps |
| `fanOut(tasks) → summaries` | run independent work in parallel; return **summaries, never transcripts** | native parallel agents / a workflow engine | a sequential loop |
| `ask(decision) → choice` | block on a human decision — indefinitely, if needed — including every floor act (mint, retire, irreversible ops) | an interactive approval prompt | a pause-and-resume sentinel: halt, emit the decision, resume on answer |
| `onTrigger(event\|schedule)` | fire work on an event or a schedule | commit/merge/CI hooks, a scheduler | manual invocation |
| `runProcedure(name)` | run a named, composable sub-procedure | a skill / procedure registry | an inline procedure |
| `journal` | idempotent, duplicate-safe, replayable run-state | durable run-state files + an idempotency contract | the same, single-process |

**The `journal` discipline** is what makes a stateless executor honest. Every step is **idempotent and
keyed**, so re-running is duplicate-safe and resume-from-disk is genuinely free — not a fragile
save-point that can re-branch on corrupt state. This adopts the *discipline* of durable-execution
engines (idempotent, replayable steps) without taking on one as a dependency. If maintaining the
discipline by hand ever proves too costly, the same interface can wrap a real engine — and the core
still does not change.

**The guiding rule is progressive enhancement, not lowest-common-denominator.** The reference host uses
every capability to the fullest, and the procedures are *prompt-shaped for their host* — so a leaner
harness yields a materially thinner product, not the same product through a thinner adapter. The
interfaces buy one specific thing: they keep the *core* from *depending* on any one host, so the
executor — model **and** harness — stays fungible. The adapter is allowed to be **thick where it
counts.** **Derived rule (its home is §13):** fan out for breadth, never to hide the interactive
worker — every isolation boundary returns summaries, not transcripts.

---

## 12. Architecture — three rings, two seams

The Runtime is three concentric rings, each with a clean boundary. This is the whole portability story.

1. **The engine (core).** Pure, project- and harness-agnostic: the **item/queue model**, the **check
   registry schema** (including the check lifecycle), the **planner**, the **loop / state machine**, the
   **floor protocol**. It knows nothing about any specific harness and nothing about any specific
   codebase. It is git-native files plus small, tested helpers — not an external service.
2. **The capability adapters (seam #1 — the harness).** The capability interfaces of §11. One adapter
   binds each interface to a host's richest feature; another binds its own or degrades.
3. **The content (seam #2 — the project).** The **check library**, **knowledge store**, and **adapter
   bindings** specific to the repo under management — its architecture invariants, its flow definitions,
   its domain dossiers, all encoded as checks and dossiers.

Everything in rings 2–3 is swappable; ring 1 never depends outward-in. The result binds to **no**
architecture: serverless, monolith, event-driven, micro-frontend — all are just content the checks
encode. Two seams, two axes of portability: the harness seam keeps the core from depending on any one
agent or host; the project seam keeps it from depending on any one codebase. The reference project is
the *first* check library, not a constraint baked into the engine — which is also why the Runtime's
patterns are liftable into other systems whether or not "the Runtime" ever ships as a standalone
product (§15).

---

## 13. Design laws

The spine. These are not aspirations; each is enforced, and each answers a failure mode from §2.

1. **Single-active.** At most one item — and at most one delivery epic — in progress at a time; and the
   active item's diff stays inside its declared scope, enforced by the scope-gate check (§8).
2. **Derive, don't store.** Store only irreducible *decisions* (status, rank, type, pointers,
   done-criteria); compute everything else (priority, membership, rollups, dates) at read time. Any
   stored knob (a rank weight, a lane threshold, the floor's sensitivity) must itself be a **checked
   property** — a stored value with no validating check is forbidden.
3. **Deterministic-first.** Anything mechanizable is a tested script or a deterministic check, not
   prose.
4. **The human floor.** Irreversible or outward-facing acts always require explicit human approval,
   surfaced as a real choice — even in auto mode. **Enforcement itself is a floor act: checks are
   minted *and* retired only at the floor** (§9), never created or lowered by drift.
5. **Evidence before done.** Nothing is "shipped" without proof — every *currently-intended* gate
   passes. *exit 0 ≠ pass.* The gate set is itself floor-governed: the only sanctioned way past a
   failing guard is to *retire or supersede it at the floor* (§9 curate), which changes what "all gates
   pass" means and is itself an evidenced decision — never a silent skip.
6. **Stateless executor.** The agent is disposable; all state lives on disk; a reset is free. This holds
   *because* every step is idempotent and keyed (the `journal` discipline) — resume is replay, not a
   fragile save-point.
7. **Harness-agnostic core, maximal adapter.** Progressive enhancement (§11): the core depends only on
   the capability interfaces; the adapter uses everything the host offers.
8. **Scoped wake.** Each wake hands the executor the *minimal sufficient* payload — the active item, the
   scope it touches, and only the dossiers and audits that scope reaches. Never the whole store — but
   the global invariant gates always ride along (§7): scoping narrows retrieval, never enforcement.
9. **Legibility.** The developer can always see what is **active**, what is **queued and why** (the
   derived priority), what findings are open, what enforcement exists and why (provenance), and what is
   **paused on the floor** — and can interject at any point. State the developer cannot see cannot be
   trusted or corrected, so the decision-bearing spine stays visible.

**Two standing constraints** (open frontiers, stated as positives):

- **Relationships are derived or checked, never hand-maintained stored edges.** Dependencies are
  preconditions, and preconditions are checks (§7) — so derived dependency *views* are welcome; stored
  dependency *state* is not.
- **Fan out for breadth only; keep the decision-bearing worker inline and visible.** Isolate
  decision-free, parallelizable work; never isolate the collaborative spine. Any isolation boundary
  returns summaries and preserves human-reachability.

---

## 14. Non-goals, risks, and mitigations

**Non-goals.**

- **Not a task tracker or project-management SaaS.** The queue is the visible surface; the product is
  the runtime beneath it.
- **Not an agent framework.** It sits *above* per-task agent procedures and orchestrates them; it does
  not replace them.
- **Not a hand-maintained knowledge base or graph.** Knowledge is checks (executable) plus
  lessons/decisions/dossiers (append-only). Any relational view is derived or checked.
- **Not a planner that stores priorities.** Priority is computed at read time and confirmed by the
  human.
- **Not append-only enforcement.** Checks are *curated* — minted and retired at the floor (§9) — not
  accumulated forever. A monotonic guarantee without a retirement path would just be a new kind of
  drift.
- **Not a dependency on any one orchestration or policy engine.** Disciplines are adopted behind
  interfaces; a real engine is wrapped only if a discipline becomes too costly to maintain by hand.
- **Not a fully-automated check-minting loop.** The human ratifies both arms of the backward edge (§9).

**Risks and mitigations.**

- **Judgment-check flake.** → Deterministic-first; a `flake_contract` and evaluation scenario per
  judgment check; the eval harness regresses them.
- **The registry becomes new drift-prone state.** → The registry is self-checked (§6); a check that
  cannot run is a finding.
- **Enforcement rot — guards outlive the properties they guard.** → The check lifecycle (§9 curate
  arm) plus the meta-check's dangling-scope detector (§6), which surfaces obsolete guards as retirement
  candidates for the floor. Curation is a first-class operation, not an afterthought.
- **The moat accrues slowly, and it is the unbuilt half.** → Acknowledged as the central execution
  risk: the forward loop is commodity and proven; the backward edge is the differentiator and is not
  yet closed. The realization sequence (§15) therefore proves the backward edge *first*, on the
  reference project, before generalizing.
- **Cold-start cost** — a new repo starts with an empty check library. → Ship a **starter check
  library** plus a "works on a normal repo" on-ramp, so an adopter gets value before authoring the
  whole content ring.
- **The adapter is thicker than "thin."** → Acknowledged: procedures are prompt-shaped for their host,
  so portability is *progressive enhancement*, not "give up nothing." The core stays pure; the adapter
  is allowed to be rich.

---

## 15. Design frontiers

The questions the realization phase answers next — direction is set, detail is open. **Sequencing
note:** because the moat *is* the backward edge and the backward edge is the one part not yet closed,
the realization phase proves it first — the lesson → registered check → eval scenario path,
end-to-end, on a handful of real lessons from the reference project — before widening the forward loop
or the portability seams.

1. **Realization taxonomy.** The concrete mapping of each component to *rules* (checks) · *skills*
   (procedures) · *workflows* (orchestration) · *agents* (scheduled watches / the worker) · *helpers*
   (tested scripts).
2. **Capability adapter contract.** The precise signatures of the capability interfaces (§11) and the
   degradation rules, with the pause-and-resume sentinel formalized.
3. **`journal` idempotency contract.** The keying scheme and step-replay semantics that make resume
   duplicate-safe on a git-native substrate.
4. **Minting *and retirement* heuristics.** *When* a shipped fix should draft a check (not every fix
   should), *when* a shipped change should surface a guard as a retirement candidate, how supersession
   chains are recorded, and how the agent chooses deterministic vs. judgment.
5. **Starter check library + on-ramp.** The smallest repo and smallest library that deliver value on
   day one.
6. **Operational surface.** Whether the developer-facing view merely *renders* state, or also *runs*
   floor-gated operations through the single executor and adapter.
7. **Product name.**
