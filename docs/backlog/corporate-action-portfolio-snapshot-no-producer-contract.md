---
id: corporate-action-portfolio-snapshot-no-producer-contract
status: parking
type: bug
notes: "CORPORATE_ACTION_APPLIED + PORTFOLIO_SNAPSHOT_IMPORTED have no producer zod contract/emitter — consumer fixtures can't be typed without standing up a producer contract first. Split out of typed-test-fixtures-cross-domain-consumer-migration."
references: []
out_of_scope:
  - "Creating the producer contract / CDC emitter — that's a production change, not a test-layer migration"
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: typed-test-fixtures-leftovers
epic_role: core
---

# CORPORATE_ACTION_APPLIED / PORTFOLIO_SNAPSHOT_IMPORTED — no producer contract to type fixtures against

Surfaced 2026-06-19 during pre-adoption verification of [[typed-test-fixtures-cross-domain-consumer-migration]],
whose body wrongly claimed *all* 8 listed events have a usable producer contract. Two do not, so
they are split OUT of that core item (atomicity — one item = one closure verdict).

## Evidence

Both events are declared only as `eventName()` constants — there is **no producer subject schema**
and **no CDC emitter**. The consumer handlers document the boundary explicitly:

- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts:114,123` — `// boundary: no producer zod contract for CORPORATE_ACTION_APPLIED … no producer CDC contract in execution-adpt/domain`
- `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:180,184,190,194` — same boundary note for `PORTFOLIO_SNAPSHOT_IMPORTED` and `CORPORATE_ACTION_APPLIED`
- name-only declarations: `services/execution/execution-adpt/src/domain/events.ts:25-26`, `services/execution/broker-sim-adpt/src/domain/events.ts:9`, `services/ledger/*/src/domain/events.ts`

Affected legacy consumer fixture call sites (cannot be typed today):

- `services/ledger/ledger-ctrl/test/**` unit ~`:215` (`CORPORATE_ACTION_APPLIED`)
- `services/ledger/reconciliation-ctrl/test/**` unit ~`:297` (`CORPORATE_ACTION_APPLIED`), ~`:287` (`PORTFOLIO_SNAPSHOT_IMPORTED`)

## Why captured (not core)

Genuinely orthogonal to the epic's `done_when` (scoped to *migratable producer events*). Same class
as the already-captured [[account-closure-requested-never-emitted]] and
[[investor-web-event-contracts-surface]] — events with no producer-owned contract surface. Migrating
these would require first creating a producer contract, which (a) is a production change out of scope
for a test-layer-only migration, and (b) cannot be validated against a real producer (no emitter
exists) per the [[event-subject-contracts]] lesson "validate against the REAL producer, not fixtures".

## Promote when

A producer contract surface is stood up for these events — i.e. when execution actually emits
corporate-action / portfolio-snapshot-import events (today both are "planned" only). At that point
register the producer schema in `EventSubjects` and migrate the consumer fixtures.
