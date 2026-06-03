# Read-Model Ownership

**Status:** canonical reference — do not edit without updating the type-enforcement layer in
`libs/event-processor/src/types/ownership.ts`.

**Related:** program spec
`docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md` —
describes the problem, decomposition into workstreams w0–w6, and settled decisions.

---

## 1. The Rule

> **Every aggregate has exactly one owner.** The owning bounded context maintains canonical
> state, announces changes via versioned events (CDC-as-outbox), and is the sole writer of
> that aggregate's row. Everyone else keeps a **pure projection** fed by the owner's
> announcements. A context's intent to change data it does not own is expressed as a
> **request-event** to the owner — never as a local write to its projection.

This is canonical CQRS + event-driven microservices applied at the row level. It introduces
no new architectural concept; it tightens the ones Nestfolio already has.

---

## 2. The Discriminator

**After an entity is created, who drives its ongoing state changes?**

| Answer | Kind | Write style |
|---|---|---|
| A **local actor** — the user or the service itself | **command-owned** | Field-level `update`, condition expressions, read-your-own-writes |
| An **external authority** — another service, broker, or settlement system | **pure projection** | `projectVersioned` (P1), `record` (P2), or derived (P3); never a direct local write |

### Canonical look-alike example: `Notification` vs `Deposit`

Both rows are **seeded** by an event from another service (`NOTIFICATION_CREATED`,
`DEPOSIT_DETECTED`). Their ownership diverges immediately:

- **`Notification` → command-owned.** After creation the user marks it read — a *local*
  actor drives ongoing state. `investor-bff` owns this row and writes it field-by-field.
- **`Deposit` → projection P1.** After creation the settlement path is driven by
  Execution/Ledger — an *external authority*. `investor-bff` holds a pure versioned copy;
  a user's intent to initiate a deposit becomes a command-event, not a local row write.

The "created elsewhere" detail is irrelevant; the discriminator is who drives *subsequent*
state changes.

---

## 3. The `__version` Convention

Owned rows carry a **`__version` attribute** (double-underscore, mirroring `__typename`).
The owning producer stamps it on every write and carries it top-level in every emitted event.
Projecting consumers read it from the event and pass it to `projectVersioned` as the
`version` parameter.

### Per-producer version source (settled — WS-B, 2026-06-02)

Every governed **owned** row that feeds a downstream `Projection<'P1'>` carries a
monotonic version top-level in its emitted events:

| Producer (owner) | Row → event | Version field | Stamp mechanism |
|---|---|---|---|
| decision-workflow-ctrl | `DecisionPacket` → `DECISION_PACKET_*` | `__version` | `update(..., { add: { __version: 1 } })`; seed `__version: 1` |
| investor-bff | `InvestorProfile` → `INVESTOR_PROFILE_*` | `__version` | resolver `SET #v = if_not_exists(#v,:zero)+:one`; seed `__version: 1` |
| investor-bff | `Mandate` → `MANDATE_ISSUED`/`MANDATE_REVOKED` | `__version` | seed `__version: 1` on issue; revoke resolver `if_not_exists(#v,:zero)+:one` |
| market-intelligence-ctrl | `MarketSnapshot` → `MARKET_SNAPSHOT_UPDATED` | `__version` | `update(..., { add: { __version: 1 } })` upsert |
| investor-profile-ctrl | `InvestorProfileSnapshot` → `INVESTOR_PROFILE_SNAPSHOT_*` | `__version` | `update(..., { add: { __version: 1 } })` upsert |
| ledger-ctrl | `LedgerEntryEvent` (derived event row, `__typename='LedgerEntryEvent'`; source table row is `LedgerEntry`) → `LEDGER_ENTRY_RECORDED` | `lastEventSequence` | reducer-accumulated monotonic sequence |

`ledger-ctrl` is the one **grandfathered exception**: it carries `lastEventSequence`
(its genuinely-monotonic per-`(tenant, streamType)` sequence) rather than a `__version`
attribute. Intentional — `lastEventSequence` predates the convention and is already the
version source for investor-bff's `CashBalance` P1 projection (`projectVersioned` keyed
on `snapshot.lastEventSequence`). A redundant `__version` alias was rejected (two fields,
one value). Consumers of `LEDGER_ENTRY_RECORDED` read `lastEventSequence`; all other P1
consumers read `__version`.

`projectVersioned` takes a numeric `version` argument, **not** a fixed field name, so the
source field name is a consumer-mapping detail and neither choice violates any type. The
reserved `__version` attribute is always the name stamped on the *projected* row.

---

## 4. Projection Variants

A projection row is **exactly one** of:

| Variant | Name | Blessed intent | Description |
|---|---|---|---|
| **P1** | Versioned snapshot | `projectVersioned` | Full row state from one authoritative producer + monotonic version guard. The standard choice for most read rows. |
| **P2** | Append-only log | `record` | Event-id-idempotent appends; order-independent. `RecentActivity`, `HistoryEntry`, `Checkpoint`. |
| **P3** | Derived aggregate | Computed read (NOT `accumulate`) | Counts/rollups **computed over owned rows** or projected from an authoritative aggregate emitted by the owner. Never accumulated from disparate event types. `AdvisoryStatus` in-flight count is the canonical example. |

Command-owned rows are **not** projections. They use field-level `update` (and `record` for
the one-time seed write — see §6).

---

## 5. `projectVersioned` — Mechanics

### Signature (from `libs/event-processor/src/intents/project-versioned.ts`)

```typescript
// Static fields mode (inline):
projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fields: Record<string, unknown>,
  opts: { version: number; overrides?: KeyOverrides },
): ProjectVersionedIntent

// Mapper mode (deferred until event arrives):
projectVersioned<K extends string>(
  typename: RejectNonP1<K>,
  fieldsMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>,
  opts: { version: VersionResolver; overrides?: KeyOverrides },
): HandlerFn
```

`version` is **required** in both overloads. A P1 projection cannot be created without a
version — that is a compile-time guarantee.

### What it writes

A full-row `PutItem` with `__version: intent.version` stamped on the item, guarded by:

```
ConditionExpression:
  'attribute_not_exists(pk) OR attribute_not_exists(#v) OR #v < :version'
```

The three clauses do exactly:

| Clause | Condition | Effect |
|---|---|---|
| `attribute_not_exists(pk)` | Row does not exist yet | New row accepted unconditionally |
| `attribute_not_exists(#v)` | Row exists but has no `__version` (legacy `project()` row) | Self-heals to versioned on first P1 write |
| `#v < :version` | Stored version is strictly older | Update accepted |

**Stale or equal version** → `ConditionalCheckFailedException` → result
`{ _tag: 'projectVersioned', success: true, deduplicated: true }`. The event is **dropped as
deduplicated (terminal)**. It is deliberately **not** redriven via SQS retry. This is
distinct from `updateOrRetry`, which throws `RetryablePreconditionError` so the message is
redriven until a precondition is met.

---

## 6. Command-Side Rules (owned rows)

1. **Field-level writes only.** Use `update` (field-level `UpdateExpression`) — never a
   full-row `PutItem` for subsequent mutations. Concurrent disjoint mutations never clobber.

2. **Condition-expression invariants.** Express status-transition guards and
   `attribute_exists` checks as DynamoDB condition expressions. **Escalation rule:** when an
   aggregate's invariants outgrow what a condition expression can cleanly express (multi-row
   or cross-field logic), promote that aggregate to a command Lambda. This is an explicit
   escalation point, not a surprise.

3. **CDC-as-outbox.** The row write and the integration event are coupled by DynamoDB
   Streams. There is no separate outbox table; the stream IS the outbox.

4. **Seed-by-one-idempotent-event.** An owned row is created by **exactly one** creation
   event from an originating context (a one-time ownership handoff), using `record()` with
   `attribute_not_exists(pk)`. After that single seed, the row is command-owned for all
   subsequent writes. This covers:
   - `InvestorProfile`, `Mandate` ← seeded by `ONBOARDING_COMPLETED`
   - `Notification` ← seeded by `NOTIFICATION_CREATED`

---

## 7. Intent Toward a Non-Owned Entity

Expressed as an **emitted command or intent event** (via outbox write or AppSync →
EventBridge). Never a local write to a projection of that entity.

The UI shows in-flight intent **optimistically client-side**. Read-your-own-writes
deliberately does **not** apply to entities this context does not own — eventual
consistency is the correct model here, not a regression.

---

## 8. Type-Enforcement Mechanism

### The `ReadModelOwnership` registry

`libs/event-processor/src/types/ownership.ts` provides an **open declaration-merging
interface**. Each service opts a typename into enforcement by augmenting it:

```typescript
// In libs/event-processor/src/types/ownership.ts (shipped by workstream 0)
export interface ReadModelOwnership {}  // empty by default

// A service's ownership declaration (e.g. investor-bff/src/ownership.ts):
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    CashBalance:      Projection<'P1'>;
    Deposit:          Projection<'P1'>;
    Notification:     CommandOwned;
    InvestorProfile:  CommandOwned;
    RecentActivity:   Projection<'P2'>;
    AdvisoryStatus:   Projection<'P3'>;
  }
}
```

### Per-factory constraint table

| Factory | Constraint helper | Rejects | Allows |
|---|---|---|---|
| `projectVersioned` | `RejectNonP1<K>` | `CommandOwned`, `P2`, `P3` | P1, unregistered |
| `project`, `accumulate`, `update`, `updateOrRetry` | `RejectProjection<K>` | Any `Projection` (P1, P2, P3) | `CommandOwned`, unregistered |
| `record` | `RejectNonAppend<K>` | P1, P3 | P2 and `CommandOwned` (seed-by-one-event path) |

### Empty-registry behavior

When `ReadModelOwnership` is empty (no augmentations), the **key unions** (`P1Key`,
`AnyProjectionKey`, `CommandOwnedKey`, etc.) are all `never`. Each reject-helper's
condition `K extends <never union>` is therefore always false, so the helper reduces to
`K` (pass-through) and every `typename` compiles as a plain string. Every existing
`typename: string` call site compiles unmodified. Enforcement activates only once a
typename is registered.

### String-literal caveat

**Enforcement only fires when `typename` is a string literal (or a `const`-inferred literal
type).** A value widened to plain `string` — for example `const t: string = 'PortfolioSummary'`
— bypasses the constraint silently, because `string extends <literal union>` is `false` and
the conditional resolves to the input type unchanged. Passing string literals is the
established call-site convention; passing a widened `string` is the one known bypass. Both
callers and migration authors must be aware.

---

## 9. Per-Row Classification (proven, no exceptions)

| Row(s) | Ongoing-state driver | Kind |
|---|---|---|
| `InvestorProfile`, `Mandate` | local (goal/mode/revoke) | command-owned, seeded |
| `Notification` | local (mark-read); content seeded once | command-owned, seeded |
| `UserConfirmation`, `Rejection`, `Interaction` | local user action | command-owned |
| `CashBalance`, `PortfolioSummary`, `PositionSnapshot`, `InvestorSnapshot`, `PortfolioLatest`, `Position`, `SnapshotAt`, `Simulation*` | external (ledger / investor) | projection P1 |
| `DecisionReadModel` | external (decision-workflow / compliance) | projection P1 (producer emits versioned snapshots) |
| `AdvisoryStatus` in-flight count | derived from owned decision rows | projection P3 |
| `RecentActivity`, `HistoryEntry`, `Checkpoint` | append log | projection P2 |
| `Deposit`, `Withdrawal` (+ structurally `Order`) | external (broker / ledger settles) | projection P1 (intent → command event; settlement drives the row) |

### 9.1 Mandate fan-out (producer surface)

investor-bff is the single **owner** of the `Mandate` aggregate (the `Mandate`
sibling row, `sk='Mandate'`, carrying an atomic `__version`). It publishes the
Mandate lifecycle event stream. Two services keep their own independent physical
copy and project it — they never read investor-bff's table:

- **compliance-ctrl** — `MandateSnapshot` under `pk=GuardrailPolicy#{tenant}#{user}`,
  used by the RuleEngine.
- **decision-workflow-ctrl** — `MandateSnapshot` under `pk=MandateSnapshot#{tenant}#{user}`,
  read by the SF.

Two physical copies, one logical owner. Per-service R4 scoping (the drift-checker)
permits the same `MandateSnapshot` typename to be `Projection<'P1'>` in both
projecting services.

`MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED` are all CDC from the
Mandate row on one monotonic `__version` line, each carrying the full Mandate
image. compliance-ctrl and decision-workflow-ctrl both project `MandateSnapshot`
as `Projection<'P1'>` via `projectVersioned` keyed on that `__version`
(`read-model-ownership-mandate-projection-fix`, 2026-06-03). `updateOperatingMode`
dual-writes the InvestorProfile composite row (keeps `INVESTOR_PROFILE_UPDATED`
feeding dashboard-bff's `InvestorSnapshot`) and the Mandate sibling row in one
`TransactWriteItems`; `OPERATING_MODE_CHANGED` is re-sourced from the Mandate row.

---

## 10. Enforcement Layers — What Shipped vs What Is Planned

**Workstream 0 (this workstream) shipped layers 1 + 2:**

1. **Type-level (compile-time)** — `ReadModelOwnership` registry +
   `RejectNonP1`/`RejectProjection`/`RejectNonAppend` constraints in
   `libs/event-processor/src/types/ownership.ts`; `projectVersioned` factory with required
   `version`; version-guard test helpers in `test-support`.

2. **Canonical doc (this file)** — single source of truth, referenced by skills and audits.

**Governance workstream (w6) will add layers 3 + 4:**

3. **Skill guidance** — updates to `event-processor-patterns`, `create-service`,
   `create-feature`, `create-event`, `testing-patterns`, and the `CLAUDE.md` router. These
   land after the pattern is real in code; a skill that references an unbuilt primitive is
   itself rot.

4. **Audit drift checks** — `audit-service`/`audit-domain`/`audit-system` flags: a
   `Projection` row written by `accumulate`; a typename written by both a command and an
   event; a `Projection` with no version guard; a schema field never written (structural
   zero). Plus a CI lint gate.
