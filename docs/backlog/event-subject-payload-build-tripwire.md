---
id: event-subject-payload-build-tripwire
status: active
rank: 1
type: refactor
notes: "Complete the intended typed-Subject design so PAYLOAD changes (not just event-name changes) break consumer builds. Today consumers import producer *EventTypes NAME maps (name changes DO break builds) but type event payloads as the generic BusEvent<Record<string,unknown>> / EventPayload and re-declare payload shapes locally with `as` casts (e.g. dashboard-bff/src/transforms/portfolio-summary.ts `type LedgerSnapshot` + `event.subject as Record<string,unknown>`). The BusEvent<Subject> mechanism already exists; only ProposedTrade (advisory-adpt/domain, 3 sites) is actually cross-coupled. Scope: producers export their canonical event Subject types as contracts; consumers type handlers/transforms against the IMPORTED Subjects, removing local re-declarations + casts (kills the prefer-libraries-over-casts anti-pattern). Needs brainstorming on mechanism + producer/consumer scope. Split 2026-06-07 from the disproven nx-affected-overbroad-cyclic-service-graph item."
references: []
out_of_scope:
  - "nx-affected precision tooling — separate item nx-affected-true-affected-resolver; this workstream is type coupling, not the affected-set resolver."
  - "Graph restructuring / the '17 per-producer contract libs' idea — explicitly not required (graph is already bounded); a contracts-lib home may still be weighed as a mechanism option."
  - "Renaming/reshaping event names — the name tripwire already works; this workstream adds the PAYLOAD tripwire only."
spec: docs/superpowers/specs/2026-06-07-event-subject-payload-build-tripwire-design.md
plan: docs/superpowers/plans/2026-06-07-event-subject-payload-build-tripwire.md
topic_memory: []
validation_gate: null
---

# Event Subject payload build-tripwire — complete the intended typed-Subject design

## Goal

Changing an event's **payload shape** (its `Subject`) at the producer should break
the build of every consumer that reads the changed fields — the same compile-time
tripwire that **name** changes already get. This was one of the originally-stated
goals ("protect at build time the event changes — name **and** payload"). The name
half works today; the payload half does not.

## Current state (verified 2026-06-07)

- **Name tripwire WORKS.** Consumers import producer `*EventTypes` name-maps
  (`@nestfolio/<svc>/events`) and key handlers off them, so a rename breaks the
  consumer build. Confirmed across the whole cross-service import surface.
- **Payload tripwire ABSENT.** Consumer handlers receive `payload: EventPayload`
  (the generic type from `@nestfolio/event-processor`), and transforms type the
  unit-of-work as `UnitOfWork<BusEvent<Record<string, unknown>>>`. They then
  **re-declare the payload shape locally and cast** — e.g.
  `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`:
  ```ts
  type LedgerSnapshot = { cashBalanceCents?: number; positions?: …; lastEventSequence?: number };
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
  ```
  This local `LedgerSnapshot` is a **hand-copy** of ledger-ctrl's payload, decoupled
  from the producer. If ledger-ctrl changes the snapshot shape, this consumer does
  **not** break — it silently reads the old shape.
- **Partial implementation that already exists** (the "I thought it was done" part):
  the `BusEvent<T = Subject, S = Context>` generic mechanism is in
  `libs/event-processor/src/platform/bus.ts`, and **one** payload type is genuinely
  cross-coupled — `import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain'`
  (3 sites). Everywhere else uses generic `Record<string, unknown>` + local casts.
- **Producers don't expose Subjects cross-service.** `-ctrl`/`-bff` producers only
  map `@nestfolio/<svc>/events` (the name-map). Their `src/domain/models.ts` Subject
  types are internal — there is no path for a consumer to import them. (Only the
  cross-domain adapters expose `/domain`, which is how `ProposedTrade` is shared.)

## Scope

1. Producers export their canonical per-event **Subject** types as contracts
   (alongside the existing `*EventTypes` name-maps).
2. Consumers type their handlers / transforms against the **imported** Subject types
   instead of `Record<string, unknown>` + local re-declaration + `as` casts.
3. A producer payload-shape change then fails the consumer build at compile time —
   wherever the consumer reads a changed field.

## Open design questions (resolve via brainstorming when picked)

- **Enforcement mechanism:** (a) expose producer Subject types via a `/domain` (or
  contract) subpath + retype consumer handlers; (b) a typed name→Subject **catalog**
  with typed `emit()`/`subscribe()` wrappers so both ends are checked; (c) **zod**
  schemas per event (`z.infer` types + runtime validation, matching
  `broker-alpaca-adpt/domain/schemas.ts`). Trade-off: airtightness vs touch.
- **The EventBridge JSON boundary:** payloads cross EventBridge as untyped JSON; the
  consumer re-asserts a type. Decide compile-time-only typing vs runtime validation
  (zod) at the deserialization seam.
- **Producer + consumer scope:** all 17 cross-consumed producers, or start with the
  high-value ones (ledger snapshot, advisory decision packet, investor profile)?
- **Interaction with read-model transforms:** the `materializeToTable` /
  `projectVersioned` transform signatures are where most casts live — does the
  Subject typing thread cleanly through `toUow`/`UnitOfWork<BusEvent<T>>`?

## Relation to other work

- **Independent of** `nx-affected-true-affected-resolver` (the nx tooling fix). This
  is the payload-safety design; that is the affected-precision tool. They were
  conflated in the original (now dropped) `nx-affected-overbroad-cyclic-service-graph`
  item; the 2026-06-07 investigation proved the nx issue is unrelated to the
  cross-service contract design.
- Removing the `as` casts aligns with the prefer-libraries-over-casts convention.
- The earlier "17 per-producer contract libs" idea is **not required** for this — the
  graph is already bounded; this is about *type coupling*, not graph restructuring.
  A contracts-lib home may still be a mechanism option, to be weighed in brainstorming.
