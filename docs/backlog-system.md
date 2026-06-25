# Backlog System — Developer Guide

This guide explains the backlog infrastructure built into this repo: how work is tracked,
the discipline that keeps it consistent across agent sessions, the skills that operate on it,
and the evaluation framework that proves those skills don't regress.

It is written for developers, not agents — agents use the skills and the rules in `CLAUDE.md`
directly. It is the sibling of [`docs/agent-system.md`](agent-system.md) (the documentation /
skill-routing meta-system); together they describe how this repo is *operated*, as opposed to
[`docs/architecture/`](architecture/), which describes the *product*.

**Authoritative rules** live in `CLAUDE.md` § "Backlog Discipline". This guide summarizes and
orients; when the two disagree, `CLAUDE.md` wins and this file is stale.

---

## What This Is

Nestfolio is worked one workstream at a time by AI agents across many short-lived sessions. An
agent that finishes a task, hits a side-finding, or comes back tomorrow has no memory of what was
in flight or what to do next. The backlog system is the durable answer to **"what is being worked,
what's queued, and what got parked"** — a flat directory of one-file-per-workstream records plus an
auto-generated index, governed by a small set of invariants a linter enforces.

Without it, agents re-discover priorities every session, drop side-findings on the floor, or pivot
mid-task into unrelated work. With it, the "what next" decision is a single deterministic read.

## The Model

Two artifacts, one of them generated:

| Artifact | Role |
|----------|------|
| `docs/backlog/<id>.md` | **The record.** One file per workstream, ever. Hand-authored frontmatter + prose body. Files never move folder when they close. |
| `docs/BACKLOG.md` | **The index.** Auto-generated from every record's frontmatter by `backlog-lint --fix`. **Never hand-edit.** Sections: EPICS / ACTIVE / QUEUED / LATER / Recently Shipped (last 10). |

Every cross-reference — between records, from a record to an epic, from a topic memory back to a
workstream — is by `id`, never by file path. The `id` always equals the filename stem.

**Lifecycle** is a single frontmatter field, `status`:

| `status` | Meaning |
|----------|---------|
| `active` | In flight right now. At most **one** non-epic active at a time (zero between workstreams); at most one `type: epic` active. |
| `queued` | Committed to do next; carries a unique `rank`. |
| `parking` | Deferred. Holds a finding whose promotion trigger hasn't fired yet (the parking lot). |
| `shipped` | Done; carries a `validation_gate` describing how it was proven. |
| `dropped` | Abandoned; carries the reason. |

## Epics

An **epic** (`type: epic`) bounds the parking lot by collapsing many findings into one theme.
Members point at it via an `epic: <epic-id>` frontmatter pointer (a strict single-parent tree —
epics carry no `epic:` pointer of their own). Epics come in two roles and members in two kinds:

- **Delivery epic** (`status: active`) — on a closure clock. **One at a time.** Run via
  `/backlog-next-epic`, which drives all its members on one shared branch and ships them as a
  single PR.
- **Theme epic** (`status: parking`) — a durable root-cause bucket, unbounded, no clock. The
  parking lot's organizing structure.

- **`core` member** — load-bearing for the epic's `done_when`. Leaving it undone makes a
  `done_when` clause literally false. Epic closure (invariant 9) drains every core member.
- **`captured` member** — thematically near but genuinely *orthogonal* to `done_when`. Rides
  along to keep session context unified; **never blocks closure**. At ship, surviving captured
  members auto-spin-out into a `<epic>-leftovers` theme epic.

The discriminator is the **closure-predicate test**, not `scope:` membership: *would leaving this
undone falsify a `done_when` clause?* If yes → `core`. Only if it's genuinely orthogonal → `captured`.
When unsure, choose `core` — misfiling required work as `captured` silently drops it from the
done-definition at close.

> **Worked example.** Epic *"make BFF read-models semantically complete"* with
> `done_when: each in-scope read-model surfaces the sub-state its UI needs`. A finding "dashboard
> activity feed omits the awaiting-confirmation state" → **core** (its absence falsifies the clause).
> A finding "the same BFF logs a noisy deprecation warning on boot" → **captured** (real, thematically
> adjacent, but the epic is *done* whether or not it's fixed). The first blocks the ship; the second
> spins out to `bff-read-model-semantic-gaps-leftovers` if still open at close.

## Discipline

The contract every session follows (full text in `CLAUDE.md` § "Backlog Discipline"):

- **File-and-continue.** A side-finding surfaced mid-execution goes through `backlog-add` (which
  routes it) and you *keep working the active workstream*. Don't pivot unless the finding actually
  blocks the active done-definition.
- **Single ACTIVE.** Never silently start a second workstream while one is active.
- **Every spec/plan has an explicit "Out of scope" section** before execution; the record's
  `out_of_scope:` frontmatter mirrors it.
- **Adopting to ACTIVE re-verifies references** — the linter confirms cited paths/anchors exist,
  but a human/agent must confirm the cited section still *means* what the record claims; fix the doc
  layer first if stale.

**The 11 invariants** are enforced mechanically by `backlog-lint` (see `CLAUDE.md` for the
authoritative list). In summary they pin: `id` = filename; the single-active rules; that
design/spec records have resolvable `references:`; that active records declare `out_of_scope:` (and
active epics also `done_when:`/`scope:`); that shipped records declare `validation_gate:`; that
queued records have a unique `rank` and carry no "promote-when" trigger language (those belong in
`parking`); that `BACKLOG.md` matches the files; and the three epic rules — closure (no terminal
epic with a non-terminal member), pointer integrity (1-level tree, valid roles), and one active
epic.

**Lanes.** `backlog-next` classifies each workstream by blast radius and routes where it's worked:

| Lane | Triggers | Worked on |
|------|----------|-----------|
| **Doc-layer** | Only touches `docs/backlog/`, `MEMORY.md`, `BACKLOG.md`. | `main` directly |
| **Simple** | Single service/MFE, no deploy gate, no public-interface change, no new architectural decision. | `main` directly |
| **Complex** | Produces code/infra changes, crosses services, needs a deploy + e2e gate, or hits a Simple disqualifier. | **Worktree first → PR** |

**Backlog ↔ Memory contract.** A record's `topic_memory: [project_X.md]` is the single source of
truth linking a workstream to its memory dossier. The dossier's `related_workstreams:` is
*regenerated* by `backlog-lint --fix` — never hand-edited. Ship narratives live in the record body,
not in `MEMORY.md`.

## The Tools

Six skills operate on the backlog. Four are model-invocable (an agent reaches for them when the
situation matches) and also runnable as slash commands; two are slash-only (`disable-model-invocation`)
because they're expensive or user-initiated orchestrators.

| Skill | Invoke as | What it does |
|-------|-----------|--------------|
| **`backlog-next`** | skill or `/backlog-next [<id>]` | Start the next workstream. Runs a preflight gate (clean tree, `main` not ahead, lint clean, no stale worktrees), picks the item (resume the single ACTIVE, else top-ranked QUEUED), verifies references, classifies the lane, routes to the right downstream skill (brainstorming / writing-plans / executing-plans / a `create-*` skill), and runs the closing phase (regen docs → deploy → true-affected validation → finish branch). Redirects to `/backlog-next-epic` if handed an epic or a member of an active epic. |
| **`backlog-next-epic`** | `/backlog-next-epic <id>` | The epic orchestrator: runs a whole delivery epic as **one branch / one PR**. Promotes the epic, loops its core members through `backlog-next` in epic-member mode on the shared branch, batches the expensive e2e (Jest + Playwright) once at epic pre-done, runs the captured audit, ships a single PR. `--auto` auto-resolves decisions (each logged into the PR body) with a hard floor that still pauses on irreversible/outward-facing actions. |
| **`backlog-add`** | skill or `/backlog-add` | File a side-finding without pivoting. Epic-aware **hot-path router**: fold into the active epic (picking `core` vs `captured` by the closure-predicate test) → else join an existing theme epic → else suggest minting a new aggregation over related orphans → else park as an orphan. Writes the record and runs `backlog-lint --fix`. |
| **`backlog-lint`** | skill, or `node .claude/skills/backlog-lint/lint.mjs [--fix]` | Validate every record against the 11 invariants. With `--fix`, regenerate `docs/BACKLOG.md` and the `related_workstreams:` lists in topic dossiers. Run at every ship and on demand. |
| **`backlog-themes`** | skill or `/backlog-themes` | The cold-path clean-up: all-vs-all cluster of every parking orphan + `*-leftovers` item by shared root cause, mint/extend theme epics, drive the orphan count toward zero. |
| **`benchmark-backlog`** | `/benchmark-backlog [mode]` | Drive the evaluation harness below. Read-only except `rebaseline`. |

## The Evaluation Framework

The backlog skills are themselves ~3,900 lines of accreted procedure encoding hard-won lessons.
Changing them risks silently regressing a lesson or a behavior. The evaluation framework
(`scripts/benchmark-backlog/`) exists to make those changes **provable**: it runs the real skills
headlessly and grades each run, so a refactor can be shown to *regress nothing and add value*.

**How it works.** Each `scenarios/*.scenario.mjs` (52 today) drives a real backlog skill
(`backlog-add`, `backlog-next`, `backlog-next-epic`, `backlog-themes`) through `claude -p` in an
isolated sandbox — a throwaway git repo seeded with fixture records and shimmed `gh` / `nx` /
`deploy.sh` / `backlog-next` stubs so no real deploy, PR, or network call happens. `run.mjs` runs
each scenario N times and prints a JSON `rows` array; `report.mjs` renders it as a markdown table.

**Grading** collapses four gates into a single `gatePass` boolean per run:

1. **terminal-ok** — the headless run terminated cleanly (no crash, no unhandled pause).
2. **golden** — deterministic structural assertions about the resulting files (right record written,
   right status, index regenerated).
3. **invariants** — `backlog-lint` passes on the post-run state.
4. **rubric judge** — an LLM judge scores the run against a scenario rubric (was the *right* router
   branch taken, was the `core`/`captured` call correct, etc.).

**Three modes** (`node scripts/benchmark-backlog/run.mjs <mode>`, also via `/benchmark-backlog`):

| Mode | Purpose |
|------|---------|
| `regression` | Grade the corpus on current `HEAD` and flag any scenario whose `gatePassRate` dropped versus the committed baseline. |
| `compare <refA> <refB>` | Interleaved A/B run (A,B,A,B… per iteration to balance temporal drift) proving an intended skill change improved or didn't regress quality. |
| `rebaseline` | Run on `main` and overwrite the committed `scripts/benchmark-backlog/baseline.json`. The only mode that writes. |

Flags compose: `--skill=<name>` narrows to one skill family, `--scenario=id1,id2` to explicit
scenarios (smoke the hardened gates before a full sweep), `--iterations=N`, `--model=<id>`.

**The baseline** (`scripts/benchmark-backlog/baseline.json`) is committed and **token-denominated** —
it records both the quality gate (`gatePassRate`) and the cost signal (`tokens.total`), so a change
that holds quality but balloons cost is caught too.

Alongside the expensive non-deterministic orchestration metrics, every `/benchmark-backlog`
invocation also runs **both deterministic `node --test` layers** — the backlog skills' own unit
suites and the harness's own suites — so one call answers "is the whole backlog-skills system
healthy?". A **cost-conscious confirmation gate** guards full-corpus runs: a full sweep is tens of
millions of tokens of subscription quota, so the skill confirms before spending and never
auto-runs on a schedule.

## Pointers

- **Authoritative rules:** `CLAUDE.md` § "Backlog Discipline" (the 11 invariants, epic semantics,
  lane table, the MEMORY contract).
- **Skill internals:** each `.claude/skills/backlog-*/SKILL.md` (and `benchmark-backlog/SKILL.md`).
- **Eval framework design:** `docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md`,
  plan `docs/superpowers/plans/2026-06-24-backlog-eval-framework.md`.
- **Sibling guide:** `docs/agent-system.md` (documentation + skill-routing meta-system).
