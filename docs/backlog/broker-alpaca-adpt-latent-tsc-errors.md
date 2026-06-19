---
id: broker-alpaca-adpt-latent-tsc-errors
status: parking
type: bug
notes: "broker-alpaca-adpt has latent tsc errors masked by jest diagnostics:false; not e2e-blocking"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typecheck-diagnostics-masking
epic_role: core
---

# broker-alpaca-adpt latent tsc errors masked by jest (diagnostics:false)

A real `tsc --noEmit -p services/execution/broker-alpaca-adpt/tsconfig.spec.json` reports pre-existing type errors that the jest run masks because ts-jest is configured with `diagnostics: false` (+ isolatedModules), so type errors never fail the `test` target.

These predate the `AlpacaTransferResult` contract move (Task 2 of `broker-funding-completed-normalization-drift`) and are unrelated to it — confirmed by a git-stash A/B comparison: the ONLY Task-2-introduced errors were the 3 `AlpacaTransferResult` re-export/import breaks (`src/domain/index.ts:4,8` + `src/repositories/transfer-mapping.repository.ts:4`), now fixed. Every error below is identical with or without the Task-2 working-tree changes.

The latent set:

1. `src/handlers/event-listener.ts:267` — unused `payload` param (TS6133).
2. `test/integration/broker-alpaca-adpt.resilience.integration.test.ts:38` — `Cannot find name 'createTestContext'` (TS2304, missing import).
3. `test/unit/event-listener.test.ts:236` — unused `payload` (TS6133).
4. `test/unit/event-listener.test.ts:490,586,664` — `timestamp` not a known property of the test `EventContext` literal type (TS2353).
5. `test/unit/order-poll-handler.test.ts:113,114,131,145` + `test/unit/transfer-poll-handler.test.ts:86,103,120,137` — `Property 'status'/'filledQuantity' does not exist on type 'void | {...}'` (TS2339): the poll handler return type includes `void` and the tests don't narrow.

Fix surface: add the missing `createTestContext` import; drop/underscore unused `payload` params; fix the poll-handler return-type union (or narrow in tests); align the test `EventContext` factory to include `timestamp`. Consider also flipping ts-jest `diagnostics` ON for this project once clean, so jest catches type regressions going forward (this whole class of bug exists because it's off).

NOT e2e-blocking (jest + e2e both pass today), hence parking per the e2e-gaps-queued-vs-parking litmus.
