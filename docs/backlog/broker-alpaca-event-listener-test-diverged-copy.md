---
id: broker-alpaca-event-listener-test-diverged-copy
status: parking
type: refactor
notes: "broker-alpaca-adpt test/unit/event-listener.test.ts reconstructs the handler logic INLINE (a diverged copy) instead of importing + exercising the real src/handlers/event-listener.ts. So the typed `const subject: AlpacaOrderResult/...` emission typings added in typed-subject-contracts-execution have ZERO test coverage — a field-name typo in the real handler wouldn't be caught by its unit test. Pre-existing test-infra divergence, surfaced by the slice's code-quality review. Promote when next touching broker-alpaca event-listener tests, or in a test-infra cleanup sweep."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: test-uses-divergent-copy-not-canonical
epic_role: core
---

# broker-alpaca event-listener.test.ts is a diverged copy, not a module import

Surfaced 2026-06-10 by the `typed-subject-contracts-execution` (slice 3) code-quality review.

## What

`services/execution/broker-alpaca-adpt/test/unit/event-listener.test.ts` reconstructs the
handler logic inline rather than importing from `src/handlers/event-listener.ts`. The test
exercises the test-internal copy, not the shipped handler.

## Impact

The slice typed all ~11 `record()` emission payloads in the real handler via
`const subject: AlpacaOrderResult | AlpacaTransferResult | AlpacaAccountSnapshot = {...}`.
None of that is covered by `event-listener.test.ts` — a typo or a contract drift in the real
handler would not fail the unit test. Coverage of the emission typings rests on the e2e gate
(which validated them against real emissions) + tsc, not the unit test.

## Fix direction

Refactor `event-listener.test.ts` to import + exercise the real handler (inject mocked deps /
AlpacaClient) instead of reconstructing it inline, so the typed emissions are unit-covered.

See [[project_event_subject_contracts]].
