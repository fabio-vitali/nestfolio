---
id: ledger-ctrl-resilience-shuffle-stale-fixtures
status: shipped
type: bug
notes: "ledger-ctrl resilience full-shuffle integration test red: stale depositId deposit fixture + filledQty/no-symbol ORDER fixtures. RESOLVED in WS-4."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Resolved as part of WS-4 (ledger-ctrl-live-tax-lot-missing-order-fields, commit bac4c534 on feat/epic-order-execution-money-path): migrated the order-agnostic full-shuffle fixtures to honest post-WS-3 shapes — DEPOSIT_SETTLED → FundingSnapshotSchema (transferId/direction/status/currency/executionMode/initiatedAt/timestamp), both ORDER_FILLED → carry symbol/side. With WS-4's listener normalization, RecordFill now applies real economics. `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run ledger-ctrl:test-integration` → 19/19 green (2 suites), including the order-agnostic full shuffle. Discovered during WS-4's per-member integration gate."
epic: order-execution-money-path
epic_role: captured
---

# ledger-ctrl resilience "order-agnostic full shuffle" test red — stale fixtures

## Evidence

`services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`,
`describe('ledger-ctrl resilience: order-agnostic full shuffle')` → `it('3 events in shuffled order
produce same final snapshot as sequential')`. Fails with `waitForEntryCount: timeout waiting for 1
entries` (the first sequential event — the deposit — never produces a LedgerEntry).

Two stale fixtures in the same test:

1. **Funding (line ~358-363):** `DEPOSIT_SETTLED` detail is the OLD shape
   `{ depositId, amountCents, settledAt }`. The (pre-existing) event-listener does
   `parseSubject(payload, FundingSnapshotSchema)`, which requires `transferId` + `direction` +
   `status` + `currency` + `executionMode` + `initiatedAt` + `timestamp` → the old shape is rejected
   → no LedgerEntry written → `waitForEntryCount` times out. Same class as the shipped
   [[ledger-ctrl-funding-reducer-depositid-vs-transferid]] (funding identity is `transferId`).
2. **Order (lines ~366-383):** the two `ORDER_FILLED` details use `filledQty` / `averageFillPrice`
   and carry no `symbol` / `side`. The reducer's `ORDER_FILLED` branch reads `p['symbol']`,
   `p['side']`, `p['quantity']`, `p['fillPrice']` → `RecordFill` validation fails → state unchanged.
   This is the [[ledger-ctrl-live-tax-lot-missing-order-fields]] / order-execution money-path bug
   (ORDER_FILLED drops symbol/side/quantity), documented at `event-listener.ts:49-53`.

## Provenance

Pre-existing on `origin/main` (this file's fixtures are unchanged by the shipped funding workstream).
Surfaced 2026-06-20 during the `/backlog-next` integration gate for
[[ledger-ctrl-funding-reducer-depositid-vs-transferid]]; that workstream's own funding CDC chains
passed — this shuffle failure is independent and pre-existing.

## Why captured under order-execution-money-path

The test goes green only when **both** fixtures are honest **and** the reducer can apply
`ORDER_FILLED` with real symbol/side/quantity — i.e. it is gated on the order→fill→ledger repair
([[order-execution-money-path]]). The trivial funding-fixture half cannot close the test on its own.
Not a `done_when` clause of the epic (it's a ledger resilience integration test, not the accept-decision
e2e), so it rides along as `captured`: when the epic's ledger/e2e work lands, update all three shuffle
fixtures to the honest shapes and confirm the order-agnostic invariant.

## Fix (when the epic is worked)

Migrate the deposit fixture to `FundingSnapshotSchema` shape (`transferId`, …) and the two ORDER_FILLED
fixtures to whatever symbol/side/quantity-carrying shape the money-path repair settles on; re-run
`NESTFOLIO_INTEG_PREFIX=dev pnpm nx run ledger-ctrl:test-integration`.
