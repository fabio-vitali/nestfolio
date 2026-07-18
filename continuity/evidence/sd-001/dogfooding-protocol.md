# SD-001 Dogfooding Measurement Protocol

This is the frozen measurement protocol for the sustained Nestfolio
dogfooding validation period. Its normative content is fixed by the SD-001
— Sustained Dogfooding Bootstrap contract
(`sessions/SD-001-sustained-dogfooding-bootstrap/context-pack.yaml` in
continuity-lab). From the moment its SHA-256 is recorded in dogfooding
ledger entry 0, any byte change to this file is `PROTOCOL_FROZEN_VIOLATION`;
the only amendment path is a contracted protocol amendment, with an
explicit validation Decision when a Product Foundation threshold changes.

This protocol and the append-only dogfooding ledger
(`continuity/evidence/sd-001/dogfooding-ledger.md`) are observational
bookkeeping ONLY: they carry no rule authority, are never read by the
Continuity engine, gate nothing automatically, and are not a product
mechanism.

## Definitions

### Non-trivial Work Item

A store Work Item (`continuity/artifacts/work-items/**`) for real Nestfolio
development whose completion requires explicit completion criteria and
whose implementation changes product source, tests, infrastructure, or
product documentation. Pure Continuity bookkeeping (ledger appends,
evidence packaging), typo-class fixes, and this bootstrap itself are
trivial and never counted. Classification is recorded in the ledger at the
item's first appearance and is not silently reclassified.

### Sampled resumption

Every resumption during the period is a sample (the population is the
sample; no selection bias is possible). A resumption is a fresh Claude Code
Session — new session identity — that continues in-progress dogfooded work
after a session boundary or interruption, either by resuming an open Run
through the pinned engine or by selecting the next action for in-progress
work from repository state. Each sample is appended contemporaneously (in
the same session it measures) with: machine-captured UTC, session identity,
Run/Work Item references, the source of the next action (store artifacts,
Handoff, Checkpoint, backlog state — versus prior chat transcript
reconstruction), whether the identified next action proved correct, and any
material-loss, duplicated-effect, or silently-skipped-step event observed
(criteria 1, 2, and 3 inputs).

### Multi-item effort

Two or more related Work Items spanning two or more Sessions, grouped by a
Working Set, a `docs/backlog` `type:epic` bucket, or an explicit grouping
declaration in the ledger. Epic-equivalent: a `type:epic` backlog bucket or
Working Set with three or more Work Items worked through Continuity during
the period (criteria inputs for the five-effort/two-Epic minimum).

### Overhead sample

Per working session, a contemporaneous self-report: minutes spent on
Continuity bookkeeping and state recording versus total active development
minutes (criterion 9 input). Absence of a sample for a session is recorded
as a gap, never backfilled.

### Active week

Consecutive seven-day UTC windows counted from the period start (the
SD-001-PUB committer UTC). A week with at least one dogfooded working
session is active. The ledger records activity truthfully per week;
whether a zero-activity week breaks "six consecutive weeks of active
development" is adjudicated by the owner at the verdict, not by the
protocol.

## Criterion derivations

1. Work continuity: resumption samples — correct next action without chat
   reconstruction, target at least 90 percent.
2. State integrity: resumption samples — material Work Item, scope
   constraint, accepted Decision, or completion-criterion loss events,
   target zero material losses.
3. Resumable execution: store Run/Checkpoint records plus resumption
   samples — duplicated completed effects or silent skips on tested
   recoveries, target at least 90 percent clean.
4. Evidence-bound completion: derived mechanically from the store —
   completed non-trivial Work Items with explicit criteria and linked
   validation Evidence, target at least 90 percent.
5. Practical work selection: ledger events — next Work Item or Working Set
   selected from repository state without manual priority/dependency
   reconstruction in chat.
6. Skill reuse: ledger events recording each executable skill or procedure
   invocation on a real task — target at least three skills each reused on
   three or more real tasks.
7. Learning loop: store lessons/observations/decisions/change-proposals
   plus owner-applied changes through the MI-007 governed path — target at
   least five evidence-backed Lessons with at least two reused through an
   updated Skill, validator, check, Guard, or Pack rule.
8. Project-specific separation: period-close classification review of
   `continuity/bindings/**` versus core, plus ledger events recording any
   promotion pressure.
9. Operational overhead: overhead samples — Continuity bookkeeping below
   15 percent of active development time.
10. No forced external duplication: ledger events recording any forced
    wholesale copy of external backlog/CI/policy state, target none
    forced.
11. Failure visibility: ledger events recording unresolved decisions,
    failed validation, stale state, and unavailable evidence, each visible
    and fail-closed with its typed diagnostic, never a silent completion
    claim.
12. Developer preference: the owner's explicit statement captured at the
    verdict session, never before.

## Cadence

One ledger append per calendar week of the period (weekly entry: week
number, activity summary, running counters), plus event appends at each
resumption sample, each non-trivial Work Item first appearance and
completion, each skill-reuse event, each overhead sample, and each notable
failure-visibility or duplication event. A missed week or missing sample is
recorded as an explicit gap entry; nothing is silently backfilled. Ledger
appends are committed on Nestfolio main through the repository's normal
ship mechanisms and may share a commit with the work they record or stand
alone; no program-level publication ceremony applies to routine appends —
the ceremony remains only for this bootstrap (SD-001-PUB) and for the
verdict session's own records.

## Frozen protocol and amendment rule

`continuity/evidence/sd-001/dogfooding-protocol.md` (this file) is the
frozen measurement protocol for the whole period. From the moment its
SHA-256 is recorded in dogfooding ledger entry 0, any byte change to this
file outside a contracted protocol amendment is `PROTOCOL_FROZEN_VIOLATION`.
Thresholds may be revised before implementation only through an explicit
validation Decision (Product Foundation); any such revision is a
contracted protocol amendment, never a silent edit.
