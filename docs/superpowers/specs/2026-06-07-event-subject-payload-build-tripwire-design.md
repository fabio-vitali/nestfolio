# Event Subject payload build-tripwire — design

- **Date:** 2026-06-07
- **Backlog item:** `docs/backlog/event-subject-payload-build-tripwire.md`
- **Type:** refactor (cross-service, `requires_deploy: true`)
- **Status:** design approved — ready for implementation plan

## Problem

Changing an event's **name** at the producer already breaks every consumer's build:
consumers key their handlers off the producer's `*EventTypes` name-maps
(`@nestfolio/<svc>/events`), so a rename fails the consumer compile. This is the
intended "events are a contract, protected at build time" behaviour.

Changing an event's **payload shape** (its `Subject`) does **not** break anything.
Consumers receive `subject: Record<string, unknown>` from the event-processor
pipeline and **re-declare the payload shape locally, then cast**:

```ts
// services/investor/dashboard-bff/src/transforms/portfolio-summary.ts (today)
type LedgerSnapshot = { cashBalanceCents?: number; positions?: …; lastEventSequence?: number };
const subject = event.subject as Record<string, unknown>;
const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
```

This local `LedgerSnapshot` is a hand-copy of ledger-ctrl's payload, decoupled from
the producer. If ledger-ctrl changes the snapshot shape, this consumer keeps
compiling and silently reads the old shape. The same anti-pattern appears across
**~21 cast sites / 13 locally re-declared payload types in 9 consumer services**,
with three types duplicated outright: `LedgerSnapshot` ×3, `FundingSnapshot` ×2,
`BalancePayload` ×2.

The only payload genuinely shared as a contract today is `ProposedTrade`
(`@nestfolio/advisory-adpt/domain`, a plain interface consumed correctly by
execution-ctrl) — the precedent this design generalises.

## Goal

A producer changing its event payload shape **breaks the build** of every consumer
that reads a changed field (compile-time), and a producer emitting a shape that
violates its own declared contract **fails loud at runtime** (→ DLQ) rather than
corrupting a read model silently.

## Decisions (locked in brainstorming 2026-06-07)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Enforcement mechanism + JSON-boundary | **zod contract per event** — compile-time `z.infer` tripwire **and** runtime `parse()` validation at the consumer's deserialization seam |
| 2 | Where contracts live | **Per-producer `src/domain/contracts.ts`** (zod-only), exposed via new `@nestfolio/<svc>/contracts` tsconfig alias — producer owns the shape it emits |
| 3 | Scope | **Every actual cast/re-declaration site** (~21 sites, ~8 producers, 9 consumers) — `done = the anti-pattern is gone everywhere it exists today` |
| 4 | Runtime failure mode | **Throw → retry → DLQ** (existing event-processor poison-pill path); optional fields modelled `z.optional()`; business "is this event relevant?" guards stay explicit post-parse |

Rationale: the repo already depends on zod (`^3.24.0`, used in 23 services + libs,
including `event-processor`'s own `domain/schemas.ts` and `platform/validation.ts`),
so runtime seam-validation is an established pattern, not a new dependency. The
single-source-of-truth schema (one zod object → the consumer's imported type **and**
the runtime validator **and** the producer's self-check) is the most reusable
cross-domain pattern and aligns with the "fail loud, not silent" philosophy
(`[[feedback-no-silent-fallback-in-agent-results]]`).

## Architecture

### 1. The contract — one zod schema per cross-consumed event Subject

Each producer adds `src/domain/contracts.ts`:

```ts
// services/ledger/ledger-ctrl/src/domain/contracts.ts  (imports ONLY zod)
import { z } from 'zod';

export const LedgerPositionSchema = z.object({
  quantity: z.number().optional(),
  lastFillPrice: z.number().optional(),
});

export const LedgerSnapshotSchema = z.object({
  cashBalanceCents: z.number().optional(),
  positions: z.record(LedgerPositionSchema).optional(),
  lastEventSequence: z.number().optional(),
});
export type LedgerSnapshot = z.infer<typeof LedgerSnapshotSchema>;
```

- Imports **only** zod — no handlers, no AWS SDK — so a consumer importing the
  schema (a runtime value) bundles only zod + the schema, not the producer's code.
- Exposed via a new line in `tsconfig.base.json`:
  `"@nestfolio/ledger-ctrl/contracts": ["services/ledger/ledger-ctrl/src/domain/contracts.ts"]`.
- **Non-strict** (default zod `.object()` strips unknown keys): a producer *adding*
  a field stays backward-compatible; only *removing or retyping a consumed field*
  trips the wire. Do **not** use `.strict()`.
- Optional fields are modelled `z.optional()` so legitimate partial payloads parse
  cleanly and never throw.
- Where a producer already defines zod schemas (`broker-sim-adpt`,
  `broker-alpaca-adpt`, `broker-ctrl`, `compliance-ctrl`, `investor-bff`), relocate
  or re-export the relevant schema into `contracts.ts` and add the alias — do not
  author a duplicate.

### 2. The consumer seam — `parseSubject` in `event-processor`

One new helper (home: `libs/event-processor`, beside `platform/validation.ts`):

```ts
// pseudo-signature — exact ergonomics finalised in the plan
export function parseSubject<S extends z.ZodTypeAny>(
  carrier: UnitOfWork<BusEvent<unknown>> | EventPayload,
  schema: S,
): z.infer<S>;
```

- Accepts either a `UnitOfWork` (reads `uow.event.subject`) or an `EventPayload`
  (reads `payload.subject`) — both transform styles exist in the codebase
  (uow-style transforms like `portfolioSummary`, and `projectVersioned`/`project`
  fields-mappers that receive `EventPayload`).
- Internally `schema.parse(subject)` → returns the validated, fully-typed subject.
- Becomes the **only** place a transform reads `event.subject`; every cast site is
  rewritten:

```ts
// after
import { LedgerSnapshotSchema } from '@nestfolio/ledger-ctrl/contracts';
const snap = parseSubject(uow, LedgerSnapshotSchema);   // typed; no `as`
if (snap.cashBalanceCents === undefined) return undefined;   // business guard stays explicit
```

- Compile tripwire: `snap.removedField` fails to compile when ledger-ctrl drops the
  field from `LedgerSnapshotSchema`.
- Runtime tripwire: `parse()` throws `ZodError` when the live JSON violates the
  schema.

### 3. Producer self-validation — two-sided coverage, zero runtime cost

At each producer's subject-construction site, annotate the constructed object
`satisfies <SubjectType>` (the `z.infer` type from its own `contracts.ts`):

```ts
const subject = { cashBalanceCents, positions, lastEventSequence } satisfies LedgerSnapshot;
```

Coverage matrix (no drift path is silent):

| Producer change | Caught by | When |
|---|---|---|
| emit **+** schema together (disciplined) | consumer **compile** error | build |
| emit only (schema stale) | consumer **runtime** `parse()` throw → DLQ | runtime |
| schema only (emit stale) | producer's own `satisfies` **compile** error, then consumer runtime throw | build (producer) |

### 4. Error handling

- `parse()` throws `ZodError` → event-processor's existing poison-pill / DLQ /
  bisect path → CloudWatch alarm (no new infra).
- Optional fields `z.optional()`; business relevance guards remain explicit
  post-parse checks (never swallowed validation errors via `safeParse`+skip).

### 5. No pipeline rework

The Subject stays erased through `toUow` → `EventPayload` → the ingestion engine
(all unchanged — the engine still casts `event.subject as Record<string,unknown>`
when invoking handlers). `parseSubject` re-establishes the precise type at the
transform's first line. We explicitly do **not** make the pipeline registration
generic over a name→Subject catalog (considered and rejected: large blast radius on
`event-processor` generics for airtightness that the runtime `parse()` already
delivers). The change is purely additive.

## Scope map

| Producer | contract(s) in `contracts.ts` | Consumers retyped |
|---|---|---|
| ledger-ctrl | LedgerSnapshot, BalancePayload, LedgerEntry | ledger-bff, investor-bff, dashboard-bff (portfolio-summary, position-snapshot), decision-workflow-ctrl |
| broker-ctrl | FundingSnapshot | investor-bff (deposit-lifecycle, withdrawal-lifecycle), broker-ctrl internal (normalizer, router) |
| broker-sim-adpt / broker-alpaca-adpt | *existing zod schemas* exposed via `/contracts` alias | broker-ctrl deposit-withdrawal-normalizer (~6 casts) |
| investor-bff | InvestorProfile/Mandate, BalanceUpdated | dashboard-bff (investor-snapshot), broker-ctrl |
| investor-ctrl | NotificationCreated | investor-bff (notification-created) |
| onboarding-bff | OnboardingCompleted | investor-bff (onboarding-completed) |
| investor-profile-ctrl | InvestorProfileSnapshot | decision-workflow-ctrl (snapshot-projector) |
| market-intelligence-ctrl | MarketSnapshot | decision-workflow-ctrl (snapshot-projector) |

The exact producer set + per-site file:line list is finalised in the plan from the
2026-06-07 cast-site census (recorded in the backlog dossier).

**Acceptance (as achieved):** zero remaining **re-declared-payload-type** casts
(`event.subject as <LocalPayloadType>`) and zero locally re-declared payload types —
the targeted anti-pattern is fully eliminated, and every census read-model transform
is typed against a producer-owned contract via `parseSubject` (the payload tripwire is
proven). Two categories of generic `as Record<string,unknown>` reads remain and are
NOT this anti-pattern: (1) the 4 broker-ctrl normalizer casts, blocked on the
`broker-funding-completed-normalization-drift` bug (filed, queued rank 2); and (2) ~27
pre-existing polymorphic/opaque/dynamic reads outside the census — the advisory agent
pipeline's composite handoff state, KB text builders, dynamic-key derivation — filed
as `residual-generic-subject-casts-cleanup` (parked; mostly appropriately `Record`).
The literal "zero `as Record` anywhere" was an overstatement of the original scope,
which targeted the re-declared-payload-type transforms.

## Testing

- **Per producer:** a unit test asserting a representative emitted subject
  `.parse()`s clean against its own schema — locks the schema to the real emit shape
  (and the `satisfies` annotation provides the compile-time half).
- **Per consumer:** existing integration tests must stay green (payload-shape
  assumptions unchanged); add one regression test per retyped consumer that a
  contract-violating payload throws and lands on the DLQ path
  (`[[feedback-regression-tests]]`).
- **Compile tripwire proof:** typecheck all 9 consumers green after retyping; the
  spec's acceptance notes include a manual "delete a consumed field from a schema →
  consumer build fails" check.
- **No new external mocks** — these are pure transform/type changes; integration
  tests keep their existing mocked-agent posture.

## Validation gate (`requires_deploy: true`)

Retyping consumer transforms with runtime `parse()` is a behaviour change (now
throws on malformed payloads), so:

1. `pnpm nx affected -t test,lint --base=origin/main` green.
2. Deploy the affected consumer services to `dev`.
3. Scoped `test-integration` on affected services green.
4. The **involved** e2e scenarios only (ledger/balance, deposit/withdrawal funding,
   advisory decision paths) — never the full suite, never Playwright unless an
   involved scenario lives there.

## Out of scope (recorded in backlog frontmatter)

- **nx-affected precision** — separate item `nx-affected-true-affected-resolver`.
  This workstream is type coupling, not the affected-set resolver. Note: importing
  `@nestfolio/<svc>/contracts` adds a consumer→producer build-graph edge — that edge
  is **the point** (it's what makes the tripwire fire); the over-approximation of
  `nx affected` is the *other* item's concern.
- **Graph restructuring / "17 per-producer contract libs"** — explicitly not
  required; the graph is already bounded. (A central `event-contracts` lib was
  considered and rejected in favour of producer-owned `contracts.ts`.)
- **Event *name* reshaping** — the name tripwire already works; this adds the
  payload tripwire only.
- **broker-ctrl `deposit-withdrawal-normalizer` (4 casts) — documented exception.**
  Surfaced in execution (Task 5b): the inbound funding-completed producers
  (broker-alpaca-adpt `AlpacaTransferResult` emits `nestfolioTransferId`/`amount`/
  no-`currency`/no-`userId`; broker-sim-adpt `WithdrawalCompleted` emits `amount`/
  no-`currency`) genuinely do **not** match the fields the normalizer reads
  (`transferId`/`amountCents`/`currency`/`userId`) — a real live-money-path
  normalization bug, plus the handlers are shared across the sim+alpaca paths.
  The normalizer cannot be cleanly typed until the adapters emit a canonical
  funding-completed shape. Filed as queued backlog item
  `broker-funding-completed-normalization-drift` (rank 2, to fix immediately after
  this workstream). The 4 `as Record<string,unknown>` casts in
  `deposit-withdrawal-normalizer.ts` therefore remain; the router half of
  broker-ctrl **was** retyped clean. "Zero remaining casts" holds everywhere except
  these 4 documented, bug-blocked sites.

## Open items for the plan

- Finalise `parseSubject` overload ergonomics (uow vs EventPayload carriers; whether
  one function with a union carrier or two named helpers reads cleanest at call
  sites).
- Confirm each producer's subject-construction site(s) for the `satisfies`
  annotation (some producers build the subject in an event-builder, some inline in a
  reducer/handler).
- Decide ordering: land `parseSubject` + one producer/consumer pair first as the
  reference implementation, then fan the remaining producers out (TDD per pair).
