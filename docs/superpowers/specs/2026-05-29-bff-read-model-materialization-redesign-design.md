# BFF read-model materialization redesign — single-writer aggregate ownership

**Date:** 2026-05-29
**Backlog:** `bff-read-model-materialization-redesign` (ACTIVE, `type: design`)
**Status:** design, pending plan
**Scope chosen:** full systemic, all BFFs (incl. externally-settled-entity ownership)

## Problem

Every BFF read model is reconstructed **field-by-field from a stream of
partially-overlapping event types with no version/ordering guard**. A survey of
all four BFFs (investor/ledger/advisory/dashboard) plus the `event-processor`
primitives found one bug *class* with four faces:

1. **Structural zeros** — fields the schema declares but no transform ever writes
   (`dashboard-bff` `cashBalanceCents`, `positionCount`), papered over with `|| 0`
   in read resolvers ("read models are sparse…").
2. **Accumulator double-count** — `dashboard-bff` `totalValueCents` is
   `accumulate`-d, but one fill emits both `BALANCE_UPDATED` and
   `PORTFOLIO_UPDATED`.
3. **Out-of-order clobber** — `project` does an unconditional PutItem on every
   delivery (including retries); a late/old event overwrites newer state. There
   is no sequence/version anywhere at the framework level (`EventContext` exposes
   only `eventId`, `timestamp`, `receiveCount`).
4. **Sparse-item race** — `advisory-bff` `decision-status-changed` band-aids an
   UPDATE-before-CREATE race with `attribute_exists(pk)` + SQS redrive.

Two latent bugs surfaced while proving the design (below): **deposit/withdrawal
settlement is broadcast-only and never persisted** (the row sits at `INITIATED`
forever), and **`dashboard-bff` `SimulationSummary`/`StreamSnapshot` are dead**
(repository writers with no callers).

These are not four bugs to patch; they are symptoms of a missing **read-model
materialization discipline**. This redesign establishes that discipline as a
canonical, reusable pattern and rolls it out across the BFFs.

## The model (plain statement)

**Every aggregate has exactly one owner — the bounded context with authority to
decide its state. Everyone else keeps a pure copy (projection) fed by the
owner's versioned announcements (events). A context's intent to change data it
does not own is emitted as a request-event to the owner — never written into a
local copy.**

**The discriminator (domain-independent):** *after an entity is created, who
drives its ongoing state changes?*
- **Local actor commands** → this context is the owner → **command-owned** row
  (read-your-own-writes; direct field-level writes).
- **An external authority** → **pure projection** (eventual consistency;
  locally-originated intent shown via optimistic UI, not by writing the copy).

This is exactly canonical CQRS + event-driven microservices — single-writer
aggregate per context, read models as pure projections, commands-to-non-owned
entities as events, eventual consistency with optimistic UI. It introduces no
new architectural concept; it tightens the ones Nestfolio already has.

## Mechanics

### Version stamping
The owning context stamps a **monotonic `__version`** (or reuses an existing
sequence such as ledger's `lastEventSequence`) on the owned row and carries it in
every emitted event. `ledger-ctrl` already does this (`snapshot-to-events.ts`
`SnapshotRecord` has `version` + `lastEventSequence`) — it is the reference.

### New primitive: `projectVersioned` (event-processor)
A WriteIntent that writes the **full** row state guarded by a version condition:
```
projectVersioned(typename, fullState, { version, overrides })
→ UpdateCommand/PutItem with ConditionExpression:
  'attribute_not_exists(pk) OR #__version < :version'
```
On condition fail (stale/duplicate) → treated as **deduplicated and dropped**
(NOT redriven — a stale event must not retry forever). This closes
structural-zeros (full-row write), double-count (project not accumulate), and
out-of-order clobber (version guard) in one primitive. It lives beside the
existing `record`/`project`/`accumulate`/`update` intents and is exercised in
`test-support`.

### Projection variants (a copy is exactly one of)
- **P1 — versioned snapshot:** full state from one authoritative producer +
  monotonic version (`projectVersioned`). Most read rows.
- **P2 — append-only log:** event-id-idempotent appends, order-independent
  (existing `record`). `RecentActivity`, `HistoryEntry`.
- **P3 — derived aggregate:** counts/rollups **computed over owned rows** or
  projected from an authoritative aggregate emitted by the owner — **never
  accumulated from disparate event types**. This re-sources the `AdvisoryStatus`
  in-flight count (today an `accumulate` over many trigger/resolution events;
  it is derivable from the advisory-owned decision rows).

### Command-side rules (owned rows)
- Direct **field-level** `UpdateExpression` writes (never full-row Put) so
  concurrent disjoint mutations never clobber.
- Invariants via DynamoDB **condition expressions** (`attribute_exists`,
  status-transition guards). **Escalation rule:** when an aggregate's invariants
  outgrow what a condition expression can cleanly express (multi-row, cross-field),
  promote *that* aggregate to a command Lambda — stated explicitly, not a surprise.
- **CDC-as-outbox:** the row write + the integration event are coupled by
  DynamoDB Streams; this is how an owner announces.
- **Seed-by-one-idempotent-event:** an owned row may be created by exactly one
  creation event from an originating context (a one-time ownership handoff), then
  is command-owned for all subsequent writes. Distinct from ongoing external
  authority. (Covers `InvestorProfile`/`Mandate` ← `ONBOARDING_COMPLETED`,
  `Notification` ← `NOTIFICATION_CREATED`.)

### Intent to a non-owned entity
Expressed as an **emitted command/intent event** (via an outbox write or
AppSync→EventBridge), never as a local write to a projection of that entity. The
UI shows the in-flight intent optimistically client-side; read-your-own-writes
deliberately does **not** apply to entities this context does not own (the
correct consistency model, not a regression).

## How it fits Nestfolio's existing design

| Already in Nestfolio | The model | 
|---|---|
| Events-only between services | …and changing non-owned data is also an event (a request), not a local write. |
| BFFs are the CQRS read side (`feedback_bff_is_read_model`) | …so BFF rows are pure copies of the owner's announcements. |
| CDC via DynamoDB Streams | …used as-is: how an owner announces and how copies are fed (outbox). |
| `ledger-ctrl` emits versioned snapshots | …already the model done right — the reference. |

Genuinely new: (1) `projectVersioned` + version plumbing in `event-processor`;
(2) discipline that a context never self-edits a copy of data it doesn't own
(the deposit case is where current code broke this).

## Per-row classification (proven, no exceptions)

| Row(s) | Ongoing-state driver | Kind |
|---|---|---|
| `InvestorProfile`, `Mandate` | local (goal/mode/revoke) | command-owned, seeded |
| `Notification` | local (mark-read); content seeded once | command-owned, seeded |
| `UserConfirmation`/`Rejection`/`Interaction` | local user action | command-owned |
| `CashBalance`, `PortfolioSummary`, `PositionSnapshot`, `InvestorSnapshot`, `PortfolioLatest`, `Position`, `SnapshotAt`, `Simulation*` | external (ledger/investor) | projection P1 |
| `DecisionReadModel` | external (decision-workflow/compliance) | projection P1 (producer emits versioned snapshots) |
| `AdvisoryStatus` in-flight count | derived from owned decision rows | projection P3 |
| `RecentActivity`, `HistoryEntry`, `Checkpoint` | append log | projection P2 |
| **`Deposit`, `Withdrawal`** (+ structurally `Order`) | **external (broker/ledger settles)** | **projection P1** (intent → command event) |

Every row resolves to a single writer. The discriminator separates look-alikes:
`Notification` and `Deposit` both start "created elsewhere," but `Notification`'s
ongoing writes are local (mark-read → command-owned) while `Deposit`'s are
external (settlement → projection).

## Externally-settled entities (the cross-domain piece)

`Deposit`/`Withdrawal`/`Order` are *started* by the user but *finished* by an
outside system, so the BFF is not their owner. Clean treatment:
- Designate an **aggregate owner in Execution/Ledger** that maintains canonical
  lifecycle state and emits **versioned lifecycle events** (requested → detected
  → settled/failed).
- `initiateDeposit` becomes an **intent event**, not a local row write.
- investor-bff's `Deposit`/`Withdrawal` rows become **pure P1 projections**.
- UI shows "submitting…/pending" optimistically client-side until the projection
  catches up.

This fixes latent bug #1 (settlement now persisted) by construction. It is the
only part of the program that reaches beyond the read-side BFFs, so it is
sequenced **last**.

## Bugs fixed by construction
- Structural zeros, double-count, out-of-order clobber → the `projectVersioned`
  full-row versioned write.
- Sparse-item race → producer emits a full versioned snapshot; no UPDATE-before-CREATE.
- Deposit/withdrawal settlement not persisted → settlement is a P1 projection.
- Dead `SimulationSummary`/`StreamSnapshot` → wire as projection or delete.

## Decomposition — program rollout (each = its own implementation workstream)

0. **Foundation** — `projectVersioned` + version plumbing in `event-processor`
   (+ `test-support`). Unblocks everything; no behavior change yet.
1. **ledger-bff (reference)** — persist `lastEventSequence`, version-guarded P1
   projections. Lowest risk; ledger-ctrl already stamps versions; proves the
   primitive end-to-end.
2. **dashboard-bff** — P1 projections for `PortfolioSummary`/`PositionSnapshot`/
   `InvestorSnapshot` from authoritative snapshots; `AdvisoryStatus` count → P3;
   delete dead `SimulationSummary`/`StreamSnapshot`. (Unblocks the deferred
   `dashboard-live-push-*` transport items.)
3. **advisory** — `decision-workflow-ctrl` emits versioned `DecisionPacket`
   snapshots; advisory-bff + dashboard project them; retire the `attribute_exists`
   band-aid + status-fragment events; `AdvisoryStatus` count → P3.
4. **investor-bff** — confirm command rows follow the field-level + condition +
   seed-by-event rules; `CashBalance` → P1 projection.
5. **Externally-settled entities** — `broker-ctrl` (Execution) owns the
   Deposit/Withdrawal funding lifecycle (Orders already Execution-owned); emit
   versioned lifecycle events; investor-bff deposit/withdrawal → P1 projections;
   `initiateDeposit` → intent event + optimistic UI; `ledger-ctrl` consumes
   "settled" for cash. Cross-domain; last.
6. **Governance / freeze (cross-cutting)** — enforcement layers 3 + 4 from
   "Freezing the model": update `event-processor-patterns`, `create-service`,
   `create-feature`, `create-event`, `testing-patterns`, the `CLAUDE.md` router,
   and add drift checks to `audit-service`/`audit-domain`/`audit-system`
   (+ CI lint). Lands after the pattern is real; updated incrementally as each
   BFF migrates. (Layers 1 + 2 — the types + canonical doc — ship inside
   workstream 0.)

Each workstream gets its own backlog item + worktree + spec/plan. This design
item's done-definition is **this spec + the decomposition** (doc-layer); the
numbered workstreams are downstream Complex work.

## Freezing the model (enforcement — non-negotiable)

This redesign exists *because* the prior model was implicit and rotted into the
four-faced bug class. A clean model that is not enforced rots identically.
Freezing therefore uses four layers, strongest first. The actual edits land
**with the workstreams** (never ahead of the code they describe — a doc/skill
that references an unbuilt primitive is itself rot).

1. **Type-level (compile-time) — `event-processor`, workstream 0.** The strongest
   "cannot deviate."
   - `projectVersioned(typename, fullState, { version })` is the only blessed P1
     write; `version` is a **required, typed** parameter — a versioned projection
     cannot be created without a version.
   - Row ownership encoded as a **type tag** (`CommandOwned` | `Projection<'P1'|'P2'|'P3'>`)
     so the intent API steers each typename to its allowed writers: `accumulate`
     on a `Projection`, or a direct command write to a `Projection` typename,
     **fails to typecheck**.
   - Reserved `__version` attribute as a typed convention.
   - The footgun (`project`, unconditional full overwrite) is restricted to
     seed/command paths — not usable for ongoing projection.

2. **Canonical doc — single source of truth.** A standing architecture doc
   (`docs/architecture/READ-MODEL-OWNERSHIP.md`) stating the ownership rule, the
   discriminator, the P1/P2/P3 variants, and the command-side rules — referenced
   by every skill below. Ships with workstream 0.

3. **Skill guidance — the default path for devs and Claude Code agents.**
   - `event-processor-patterns`: documents `projectVersioned` + variants + "never
     `accumulate` a cross-event projection."
   - `create-service` / `create-feature` / `create-event`: add the
     **ownership-classification step** ("who is the boss of this row? command-owned
     or projection?") so new code starts correct.
   - `testing-patterns`: version-guard + stale-drop test patterns.
   - `CLAUDE.md` router: pointer to the canonical doc.

4. **Audit checks — catch drift in review (the backstop).**
   `audit-service` / `audit-domain` / `audit-system` flag: a `Projection` row
   written by `accumulate`; a typename written by **both** a command and an event;
   a `Projection` with no version guard; a schema field never written (structural
   zero). Ideally also a CI lint.

Layers 1 + 2 ship inside workstream 0. Layers 3 + 4 are a cross-cutting
**governance workstream** (rollout step 6) that lands after the pattern is real
and is updated incrementally as each BFF migrates, so skills/audits always
describe true code. Enforcement is part of this program's done-definition, not an
afterthought.

## Out of scope
- The numbered workstreams' implementation detail (each gets its own plan).
- Live-push transport (deferred `dashboard-live-push-*` items) — rebuilt on the
  clean read model afterward.
- Event sourcing on the write side — explicitly **not** adopted; the system stays
  state-stored-aggregate + CDC-outbox.

## Decisions (settled 2026-05-29) & residual risks

Settled at review:
- **Externally-settled scope — KEPT in this program**, sequenced last
  (workstream 5). Not split to a sibling program.
- **Funding (deposit/withdrawal) lifecycle owner = `broker-ctrl` (Execution
  domain).** It owns the requested→detected→settled→failed lifecycle and emits
  versioned lifecycle events (adjacent to `DEPOSIT_DETECTED` from the broker
  adapters; consistent with Execution owning order lifecycle). `ledger-ctrl`
  keeps *consuming* "settled" to adjust cash — it records the effect, it does not
  own the funding rail. No new service. Orders are already Execution-owned;
  workstream 5 aligns them. Revisable within workstream 5 if it doesn't fit.
- **`__version` convention — CONFIRMED.** A reserved `__version` attribute on the
  owned row, stamped by the owning producer (investor/advisory/decision-workflow/
  broker-ctrl) and carried in emitted events; the foundation workstream pins down
  the exact attribute + carriage convention.

Residual risks (technical, for the workstreams):
- **`__version` plumbing for non-ledger owners.** Those producers don't stamp a
  version today; the foundation workstream defines the convention and each
  producer adopts it as its BFF migrates.
- **`projectVersioned` stale-handling.** Dropped-not-redriven is correct for
  stale events but must be distinguished from genuine precondition-wait
  (`updateOrRetry`); the foundation workstream must keep both paths.
