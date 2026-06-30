# The Long-Horizon Engineering Runtime — Target Architecture (Design)

> **Status:** target-architecture design (follow-on to the `2026-06-30` *Product Definition*). Stays
> at architecture/analysis level — defines *the shape of the product and how its parts fit*, defers
> the implementation plan.
> **Date:** 2026-06-30
> **Inputs:** the Product Definition spec; the deep review (`docs/reviews/2026-06-30-long-horizon-runtime-spec-review.md`);
> a 2026 OSS-landscape scan (coding agents · memory · backlog/spec tooling · policy-as-code/learning
> loops · durable orchestration/HITL).
> **Hard constraint:** the result must **replace the current `backlog-*` system with no lost value** —
> it must be a strict *superset*. Discharged explicitly in §11 (the equivalence map).
> **Locked decisions (this design's premises):** (1) **pattern-adopt OSS disciplines behind capability
> interfaces**, keep a git-native/Claude-native zero-external-dependency core; (2) **hybrid atom** —
> the *check* is the atom of consistency, the *item* is the atom of work, and the loop converts
> between them; (3) **learning loop = agent drafts, human ratifies at the floor**; (4) deliver the
> **target architecture + a no-lost-value equivalence map.**

---

## 1. Thesis (repositioned)

The deep review found that, by mid-2026, most of the original definition's pillars are commodity OSS:
git-native memory (a whole movement), durable resume + a human floor (LangGraph `interrupt()`,
Temporal/Restate), the backlog/`next`/epics layer (Backlog.md, claude-task-master, BMAD), and "a
constraint is an executable check" (ArchUnit, OPA, Semgrep — *orthodoxy*). Two things are **not**
solved anywhere: the **closed learning loop** (a shipped fix minting a durable, enforced check →
monotonic hardening) and **knowledge-as-executable-enforcement** (vs. passive retrieval).

So the product's thesis is repositioned from *"a control plane"* to its real, defensible core:

> **A coding agent whose every shipped fix can mint a permanent, enforced check — so the codebase gets
> monotonically harder to break — while the developer stays in a visible, interruptible spine, and the
> executor stays disposable (model- and harness-fungible).**

The queue, the durability, the memory, the floor are *table-stakes the Runtime integrates* — and,
per decision 1, **prefers to pattern-adopt rather than rebuild**. The moat is **the backward edge of
the loop** (§9) and **enforcement-as-memory** (§7). The nodes are commodity; the edges are the product.

---

## 2. The atom — resolving the deep fork (§11.5 of the definition)

The definition could not decide whether the spine is the *item* or the *check*. This design commits to
the **hybrid**, which is also what makes "no lost value" achievable:

- **A *check* is the atom of *consistency*** — one test of one property, in the check registry (§5).
- **An *item* is the atom of *work*** — a tracked unit with status/rank/type/epic (today's backlog
  item, unchanged).
- **The loop is the conversion between them**, and *is* the product:
  - **forward edge** — `check fails → finding → item(s)` (the watch engine + intake; §6).
  - **backward edge** — `item ships → (optionally) a new check` (the learning closure; §9).

This dissolves the fork: neither atom is subordinate; the system's identity is the *cycle that turns
one into the other*. The item-centric machinery you have today is fully retained (so: no lost value);
the check becomes first-class and the backward edge becomes the differentiator.

```
            ┌──────────────────────── knowledge store (lessons · decisions · dossiers) ─────────────┐
            │                                                                                        │
   (forward edge)                                                                          (backward edge)
   check fails → finding ──intake──▶ item ──planner──▶ worker/orch ──post-checks──▶ ship ──draft check──▶ FLOOR
        ▲   (watch engine)                                              (gates)                 │  (ratify?)
        │                                                                                       ▼
        └──────────────────── new registered check (gate/audit/invariant) ◀──── check registry ─┘
                                   "monotonically harder to break"
```

---

## 3. Architecture overview — core, adapters, content

Three concentric rings, each with a clean boundary (this is the portability story, both axes):

1. **The engine (core).** Pure, project- and harness-agnostic: the **item/queue model**, the **check
   registry schema**, the **planner**, the **loop/state machine**, the **floor protocol**. Knows
   nothing about Claude Code, nothing about Nestfolio. Implemented as git-native files + small tested
   helpers (the current substrate) — *not* an external service.
2. **The capability adapters (seam #1 — harness).** Five (now six) capability interfaces (§4). The
   Claude Code adapter binds each to its richest feature; another harness binds its own or degrades.
3. **The content (seam #2 — project).** The **check library**, **knowledge store**, and **adapter
   bindings** specific to the repo under management. Nestfolio is the *first* check library, not a
   constraint baked into the engine.

Everything in rings 2–3 is swappable; ring 1 never depends inward-out. This is the honest realization
of the definition's "two axes of portability" (§7 there) and of decision 1: the disciplines we borrow
from OSS live at the *interface*, so a real engine can later be wrapped behind a capability without
disturbing the core.

---

## 4. Capability interfaces (pattern-adopt, don't depend)

The core calls only these. Each row names the **discipline pattern-adopted from OSS**, the **Claude
Code binding**, the **graceful degradation**, and **what a real engine could later be wrapped behind
it** — without the core changing.

| Capability | Discipline adopted (OSS source) | Claude Code binding (maximal) | Degrades to | Wrappable engine (later) |
|---|---|---|---|---|
| `execute(task)` | agent-runner loop | the **worker** (inline, visible) | inline steps | a coding-agent runner |
| `fanOut(tasks)→summaries` | fan-out returns **summaries, not transcripts** (the Tier-2 scar; LangGraph Send) | **subagents / Workflow** `parallel`/`pipeline` | sequential loop | an orchestration lib |
| `ask(decision)→choice` | **HITL approval that blocks indefinitely** (LangGraph `interrupt()`, Temporal signals, tool-confirmation) | **AskUserQuestion** | the `<<HARNESS-PAUSE>>` sentinel (proven in the eval harness) | a workflow signal |
| `onTrigger(event\|schedule)` | event/cron-driven checks (Kiro hooks, CI) | **hooks / cron** (commit/merge/CI) | manual trigger | a CI runner |
| `runProcedure(name)` | composable skills | **Skill tool / superpowers** | inline procedure | a skill registry |
| **`journal`** *(new)* | **idempotent, duplicate-safe, replayable** run-state (Temporal/Restate/DBOS *discipline*, NOT save-points) | git-native **run-state files + an idempotency contract** | same, single-process | a durable-execution engine |

The `journal` row is this design's response to a review finding: the current "resume" is save-points,
and the eval corpus already carries a `resume-corrupt-stop` danger (a silent re-branch on corrupt
run-state). We **adopt the durable-execution *discipline*** — every step is idempotent and keyed, so a
re-run is duplicate-safe and resume-from-disk is genuinely free — *without* taking on Temporal as a
dependency. If that discipline ever proves too costly to maintain by hand, the same interface wraps a
real engine.

**Derived rule (carried from the definition):** *fan-out for breadth, never to hide the interactive
worker* — any isolation boundary returns summaries and preserves human-reachability (the legibility
law, §13).

---

## 5. The check registry — the new core surface

Today the project's checks are **scattered** across `backlog-lint` (11 invariants), the `audit-*`
skills, nx targets (`read-model-drift`, `service-card-drift`), and pre-commit hooks, with **no single
registry** and **no provenance**. The registry unifies them into one library — the "single thing to
build, test, and port."

A **check** declares:

| Field | Meaning |
|---|---|
| `id`, `property` | what single consistency property it asserts |
| `kind` | `drift` · `inconsistency` · `gap` · `staleness` (the definition's finding kinds) |
| `evaluator` | **deterministic** (script / nx target — cheap) **or** **judgment** (LLM-as-judge — expensive) |
| `cost_tier` | drives the *default* context (cheap → per-item gate; expensive → scheduled audit / epic-batch) |
| `contexts` | subset of {**gate**, **audit**, **invariant**} this check actually runs in |
| `scope` | the code / dossiers it covers (feeds **scoped wake**, §7) |
| `flake_contract` | for judgment checks: calibration + allowed-flake budget + the eval scenario that guards it |
| `provenance` | the lesson/decision/item that **minted** it (the backward-edge link, §9) |

Two honesty corrections from the review are baked in here:

- **"One check, three contexts" is a property of the *library*, not usually of a single check.** Cost
  forces most checks into *one* context; `contexts` records the truth rather than the slogan. A check
  *may* span contexts (e.g. a cheap invariant also run as a gate), and the registry allows it, but
  does not pretend it is the norm.
- **Judgment checks are not deterministic.** They carry a `flake_contract` and are gated by an eval
  scenario, so calling them "checks" is earned, not asserted. **Deterministic-first** is a registry
  preference: a property is mechanized if it can be.

**The registry is self-checked (this is the answer to "won't the registry itself drift?").** A
**meta-check** asserts registry integrity: every nx target / lint rule resolves to a registry entry,
every entry resolves to a runnable evaluator, every judgment check has a `flake_contract` + eval
scenario. Because a check *runs*, a stale or unrunnable check **fails loudly** — unlike a stored note,
it cannot silently rot. This same move (§13) absorbs the configuration-drift worry (`rank` weights,
lane thresholds, floor sensitivity from definition §11.6): tunable knobs become **checked**, not just
stored.

---

## 6. The forward edge — watch engine → intake → planner → execution

Mostly *existing* layers, now behind the capability interfaces and reading the registry.

- **Watch engine** *(net-new orchestration over existing checks)* — runs registry checks on
  `onTrigger` (manual/scheduled/commit/merge/CI), in their `audit`/`invariant` contexts, and emits
  **findings**. Pattern-adopts the gate+audit duality (OPA-Gatekeeper) and one-definition-many-contexts
  (Semgrep/Powerpipe). Cost-tiering decides cadence (cheap continuously; expensive batched at epic
  boundaries — e.g. the live-e2e suite, never per item).
- **Intake** *(today's `backlog-add`)* — turns each finding into **zero, one, or many items**
  (standalone / epic-member / theme), via the epic-aware router. Unchanged in behavior.
- **Planner** *(today's `backlog-next` routing + read-time index)* — `next` + `rank` + read-time
  `impact`. Priority is computed at read time; only `rank` (an explicit decision) is stored.
- **Execution engine** *(today's `backlog-next` / `backlog-next-epic`)* — **worker** (single item)
  and **orchestrator** (epic: shared branch, batched e2e once at epic pre-done, captured audit, single
  PR, `--auto` floor-gated). Now calls `execute` / `fanOut` / `journal`; the decision-bearing spine
  stays **inline and visible** (legibility, §13).
- **Gates** *(today's pre/postflight)* — registry checks in their `gate` context at item boundaries.
  *exit 0 ≠ pass.*

---

## 7. The knowledge store — and knowledge-as-enforcement

- **Storage** — git-native markdown: **lessons** (hard rules from failures), **decisions**
  (append-only design choices), **dossiers** (durable topic knowledge). This is today's
  `MEMORY.md` topic dossiers + `docs/architecture/*` + the `topic_memory ↔ related_workstreams`
  contract. **The review found git-native memory is now table-stakes — so we keep it but do not pitch
  it as the moat.**
- **Scoped wake (law, §13)** — a worker is handed only the dossiers + checks its item's `scope`
  reaches, never the whole store. (Directly mitigates the "MEMORY.md over size limit" problem you
  already hit.)
- **The distinctive move — enforcement-as-memory.** A lesson may carry a **`mints:` pointer to the
  check it became.** This is what the OSS memory field largely does *not* do: every surveyed framework
  (Letta, Mem0, Zep/Graphiti, cognee, LangMem) does passive retrieval/injection; even the nearest
  analogues inject rules *as text*. Here a lesson is **executable** — it has a registered check that
  fails the build — so knowledge enforces instead of merely reminding. It also dodges the
  self-reinforcing-error trap the literature flags, because the lesson's force is a deterministic (or
  eval-guarded) check, not re-injected prose.
- **Relationships are derived/checked, never stored edges** (the scar). A dependency is a
  **precondition**, a precondition is a **check** (`B needs contract X` evaluated against the code), so
  it cannot drift. A read-time-derived dependency view is an open frontier, not a stored graph.

---

## 8. The floor & auto mode

- **The floor** — irreversible / outward-facing acts always require explicit human approval, surfaced
  via `ask` as a real choice, even in auto mode. This is **commodity HITL** (review finding) — we
  adopt the pattern, we do not claim to invent it. Today's pre-authorized-actions list is the floor's
  *policy*: a registry-checked configuration (so it cannot silently drift).
- **Auto mode** — unattended execution bounded by the floor; `--auto` decisions are logged into the PR
  body (today's behavior), and **now also** the learning-loop ratifications (§9) are floor events.
- **Legibility (law, §13)** — the developer can always see what is **active**, what is **queued and
  why** (derived `impact`), what findings are open, and what is **paused on the floor**, and can
  interject at any point.

---

## 9. The backward edge — the learning-loop closure (the moat)

This is the one surface the OSS scan found **unsolved industry-wide** (policy-as-code rules are
hand-authored; self-improving agents persist verbal reflections or capability-skills, never
constraint-checks). It is assembled entirely from parts you already have, plus the registry.

**On item ship, when the item resolved a finding/failure:**

1. **Post-checks pass** (done is proven — existing gate behavior).
2. **The worker drafts a candidate check** — deterministic if the property is mechanizable, else a
   judgment check with a draft `flake_contract` + a candidate **eval scenario** — plus a `provenance`
   link to the lesson. (The "never again" becomes a *test*, not a note.)
3. **The floor presents it** (decision 3): **ratify · edit · decline.** Agent drafts; human ratifies —
   preserving the floor and avoiding self-reinforcing errors.
4. **On ratify:** the check is **registered** (gains its context), the **eval scenario is added** to
   the harness, and the **lesson dossier records `mints:`** the check id.
5. **Effect:** the watch engine now enforces that property forever; the codebase is **monotonically
   harder to break.** The §3 backward edge, mechanized through the floor.

**Non-goal:** fully-automated minting (decision 3) — the human ratification gate is the safety the
literature says self-improving loops lack.

---

## 10. The eval harness — the Runtime proving itself

Today's `benchmark-backlog` grades the Runtime's *own* procedures (a meta-level the review found
genuinely good, with *real but partial teeth* — deterministic golden gates bite; some rubric/judge
scenarios can "pass for the wrong reason"). Carried forward, with two roles:

- **Regression on procedures** — unchanged (the four-layer model: procedure · lessons · helpers · eval).
- **Home for minted eval scenarios** — every check ratified in §9 lands its eval scenario here, so the
  learning loop is itself regression-protected. The review's open items (cover the `backlog-next`
  outward-ops drive-to-ship; harden thin judge gates; full-corpus baseline) are the harness's own
  backlog — and, fittingly, become *findings* the Runtime files against itself.

---

## 11. The no-lost-value equivalence map (the replacement contract)

Every capability of the current `backlog-*` system, and where it lives in the Runtime. **Status:**
*kept* (behavior identical) · *renamed* (plain term) · *generalized* (same value, wider) · *absorbed*
(folded into a new surface, no behavior lost).

| Current capability (today) | Runtime home | Status |
|---|---|---|
| `BACKLOG.md` generated index | planner's **index** | kept |
| `backlog-lint` 11 invariants + `--fix` | **linter** + 11 entries in the **check registry** (invariant context) | generalized |
| `backlog-add` epic-aware router | **intake** | renamed |
| `backlog-themes` clustering | **grouping pass** | renamed |
| `backlog-next` (single-item lane routing, preflight/postflight) | execution **worker** behind `execute`/`journal`; pre/post-checks = gate-context checks | kept |
| `backlog-next-epic` (`--auto`, shared branch, batched e2e, captured audit, single PR) | execution **orchestrator** behind `fanOut`/`journal`; `--auto` floor-gated | kept |
| single-active item / single-active epic (rules 2, 11) | **law 1**, lint-enforced (= invariant checks) | kept |
| file-and-continue discipline | **intake** discipline **+** optional scope-gate check (closes review item A8) | generalized |
| epics, member roles (core/captured), closure-predicate test, leftovers spin-out | **items + epics**, members **required/incidental**, closure rules | renamed |
| lanes (doc / simple / complex) | **lane** | kept |
| `audit-*` skills + nx drift targets (`read-model-drift`, `service-card-drift`) | registry entries (**audit** context), run by the **watch engine** | absorbed |
| pre-commit hooks (test-dir, import boundaries) | registry entries (**gate**/**invariant**, `onTrigger`=commit) | absorbed |
| `MEMORY.md` topic dossiers; `topic_memory ↔ related_workstreams` | **knowledge store** + scoped wake | kept |
| `benchmark-backlog` grading harness | **eval harness** | renamed |
| four-layer skill model (procedure · lessons · helpers · eval) | the **realization taxonomy** | kept |
| pre-authorized-actions list / auto mode / the floor | **the floor** (policy = checked config) + **auto mode** | kept |
| worktree / PR / deploy discipline (`finishing-a-development-branch`, deploy gates) | execution engine + floor + capability **adapter bindings** | kept |
| read-time priority regeneration | **planner** read-time `impact` (only `rank` stored) | kept |

**Conclusion:** every current capability maps to a home with no behavioral loss. The Runtime is a
strict superset → the "replace with no lost value" constraint is discharged.

---

## 12. What is net-new (additions only — no subtractions)

1. **The check registry** (§5) — unifies the scattered checks into one library with provenance and a
   self-check.
2. **The watch engine** (§6) — a trigger layer over the existing checks (today they only fire as
   gates/manual audits/pre-commit, never as one orchestrated continuous surface).
3. **The `journal` idempotency discipline** (§4) — makes resume genuinely duplicate-safe.
4. **The learning-loop closure** (§9) — the moat; the lesson→check→eval path, mechanized through the
   floor (today it is human-stitched).
5. **Enforcement-as-memory** (§7) — lessons carry `mints:` pointers to executable checks.

All five are built from parts that already exist in embryo; none removes an existing capability.

---

## 13. Design laws (carried forward, amended by the review)

The seven definition laws + two operational laws stand. Two are **amended** to close review findings:

- **Law 2 (derive, don't store) — amended.** Store only irreducible decisions (status, rank, type,
  pointers, done-criteria) **and** a minimal config/ordering substrate that is **itself a checked
  property** (a stored knob with no validating check is forbidden — the `severity` scar). Resolves the
  `rank`/config leak the review flagged (A2).
- **Law 6 (stateless executor / "a `/clear` is free") — amended.** True only under the **`journal`
  idempotency discipline** (§4): steps are keyed and duplicate-safe; resume is replay, not a fragile
  save-point.
- Laws unchanged: single-active · the human floor · evidence-before-done (*exit 0 ≠ pass*) ·
  harness-agnostic-core/maximal-adapter · **scoped wake** · **legibility**.
- **Cautions (scars) carried verbatim:** no hand-maintained relational edges (dependencies are
  checks); fan-out for breadth only, never to hide the interactive worker.

---

## 14. Non-goals, risks & mitigations

- **Non-goal — replacing the engine with Temporal/LangGraph/OPA.** Decision 1: pattern-adopt behind
  interfaces; depend only if a discipline becomes too costly to maintain by hand.
- **Non-goal — fully-automated check minting.** Decision 3: the floor ratifies.
- **Non-goal — a stored dependency/knowledge graph.** Derived or checked only.
- **Risk — judgment-check flake.** Mitigation: deterministic-first; `flake_contract` + eval scenario
  per judgment check; the eval harness regresses them.
- **Risk — the registry becomes new drift-prone state.** Mitigation: the registry is self-checked
  (§5); a check that cannot run is a finding.
- **Risk — cold-start cost (review A7).** Mitigation (deferred to realization): ship a **starter check
  library** + a "works on a normal repo" on-ramp, so an adopter is not forced to author the whole
  content ring before getting value.
- **Risk — adapter is thicker than "thin" (review A5).** Acknowledged: procedures are prompt-shaped
  for the harness; portability is *progressive enhancement*, not "give up nothing."

---

## 15. Open questions (deferred to the realization phase)

1. **Realization taxonomy** — the concrete mapping of each component to *rules (checks) · skills
   (procedures) · workflows (orchestration) · agents (scheduled watches / worker) · helpers (tested
   scripts)*, given the four-layer model.
2. **Capability adapter contract** — the precise signatures of the six interfaces (§4) and the
   degradation rules, with the `<<HARNESS-PAUSE>>` sentinel formalized.
3. **`journal` idempotency contract** — the keying scheme + step-replay semantics that make resume
   duplicate-safe on the git-native substrate.
4. **Minting heuristics** — *when* a shipped fix should draft a check (not every fix should), and how
   the agent chooses deterministic vs. judgment.
5. **Starter check library + on-ramp** — the smallest repo + smallest library that delivers value.
6. **Operational surface (definition §11.7)** — does the developer view merely render state, or also
   run floor-gated operations through the single executor + adapter?
7. **Product name** — still TBD.

---

## 16. Relationship to the existing system

This design **promotes** the `backlog-*` suite to the Runtime's reference implementation and content
ring (Nestfolio = the first check library), generalizes its engine, names its parts, adds the watch
loop + learning closure, and quarantines all Nestfolio-specific content behind the two seams (§3). It
is the de-facto runtime that suite already grew into — now a strict superset, so adopting it loses
nothing and gains the moat.
