---
id: event-processor-explicit-idempotency-api
status: parking
type: refactor
notes: "event-processor `record()` defaults to event-id-scoped idempotency silently; misuse is a common source of at-least-once bugs (reconciliation-ctrl content-key fix, ledger-ctrl version drift hint at the pattern). Add explicit API distinction to make the choice harder to miss."
references:
  - "libs/event-processor/src/intents/record.ts"
  - "libs/event-processor/src/engine/intent-executor.ts:62"
  - "docs/backlog/reconciliation-ctrl-idempotency-race-under-parallel-load.md"
  - "docs/backlog/ledger-ctrl-version-drift-under-shuffle.md"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# event-processor: explicit idempotency-key API

## Why

`record(typename, fields, overrides?)` in `libs/event-processor/src/intents/record.ts` defaults to:

- `pk = T#${ctx.tenantId}`
- `sk = ${typename}#${ctx.eventId}`

This is **event-delivery idempotency** — every distinct EB delivery gets its own row. Correct for append-only audit records, wrong for handlers that mutate a domain aggregate (where you want **domain idempotency** keyed on the aggregate's identity / a content-derived key).

The default is silent: handlers that want domain idempotency must remember to pass `overrides` with the right pk/sk, and even then nothing prevents them from including `ctx.eventId` inside the override (which reintroduces the same bug). This has caused:

- `reconciliation-ctrl-idempotency-race-under-parallel-load` (fixed via content hash 2026-05-13).
- `ledger-ctrl-version-drift-under-shuffle` (open, same shape).

## Proposed API

Force an explicit decision at every `record()` call site by adding three named entry points instead of one overloaded function:

```ts
// Audit / append-only: one row per delivery.
record.eventScoped(typename, fields);

// Aggregate mutation: one row per aggregate id, regardless of triggering event.
record.aggregateScoped(typename, fields, { aggregateId: string });

// Content-derived: one row per logical state, regardless of how many events produced it.
record.contentScoped(typename, fields, { contentKey: string });
```

Internally each maps to the existing `RecordIntent` with the right pk/sk derivation. The library computes the content hash; callers just say "this is a content-scoped write keyed by these fields".

The current `record(typename, fields, overrides)` stays for a deprecation period but emits a lint warning when `overrides.pk` or `overrides.sk` contains a substring matching the literal `ctx.eventId`.

## Implementation scope

- Add new entry points + types in `libs/event-processor/src/intents/record.ts`.
- Add a custom ESLint rule in `tools/eslint-rules/` that flags the legacy form on mutating writes.
- Migrate one consumer (probably reconciliation-ctrl's already-fixed handler) as a reference.
- File follow-ups for migrating each remaining `record()` call after auditing it.

## Why this is parking, not active

This is a platform-library refactor with non-trivial migration. Each existing `record()` call needs human review to pick the right scoped variant — it's not a mechanical rewrite. File and pick up when there's a clear ~half-day budget. The two known bugs caused by the current design (reconciliation-ctrl, ledger-ctrl) get point fixes meanwhile.

## Out of scope

- Building tooling to auto-migrate. The choice between event/aggregate/content scoping is domain-modeling, not refactor.
- Adding a runtime warning. The lint catch at call site is preferable; runtime warnings get filtered.
