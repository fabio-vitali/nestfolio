---
id: account-closure-requested-never-emitted
status: parking
type: bug
notes: "ACCOUNT_CLOSURE_REQUESTED is declared in investor-bff/-adpt/execution-adpt/execution-ctrl events.ts but has NO production emitter — investor-bff requestAccountClosure is a noneDataSource synthetic mutation (no DDB write → no CDC), and execution-ctrl's handler logs + skip()s it. Left unregistered/legacy in Phase 3."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# ACCOUNT_CLOSURE_REQUESTED — declared but never emitted

## Evidence

`ACCOUNT_CLOSURE_REQUESTED` appears in four `events.ts` files across the system:

- `services/investor/investor-bff/src/domain/events.ts`
- `services/investor/investor-adpt/src/domain/events.ts` (or similar cross-domain path)
- `services/execution/execution-adpt/src/domain/events.ts`
- `services/execution/execution-ctrl/src/domain/events.ts`

However, no service ever publishes this event in production:

1. **investor-bff `requestAccountClosure` mutation** — implemented as a `noneDataSource` AppSync resolver (`services/investor/investor-bff/src/graphql/js-function/request-account-closure.fn.js`). It returns a synthetic response `{ closureId, status: 'REQUESTED', requestedAt }` with no DynamoDB write. Because there is no DDB write there is no CDC event — `ACCOUNT_CLOSURE_REQUESTED` is never placed on the EventBridge bus.

2. **execution-ctrl handler** — `services/execution/execution-ctrl/src/handlers/event-listener.ts:103` registers a handler for `ACCOUNT_CLOSURE_REQUESTED` but the handler body logs the event and calls `skip()`. No record is written, no downstream event is emitted.

## Phase 3 disposition

The execution-ctrl integration fixture for this path exercises only the `skip()` branch. It remains on `legacy putEvent` (unregistered in the typed-fixture registry) because there is no producer-owned contract to register — the event has no canonical emitter.

## Fix options

A. **Wire it properly**: add a DDB write in `requestAccountClosure` (converting to a `dynamodbDataSource` mutation), which produces a CDC row → `ACCOUNT_CLOSURE_REQUESTED` on the bus; update execution-ctrl to process it (record a ClosureRequest row or start a closure SF).
B. **Prune it**: remove the dead event declaration from all four `events.ts` files, remove the investor-bff resolver's synthetic response shim, and delete the execution-ctrl skip() handler + its integration test.

## Promote when

Implementing account-closure as a real feature (option A), or doing a dead-event pruning pass across all `events.ts` files (option B).
