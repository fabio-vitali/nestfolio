---
id: typed-test-fixtures-execution-deferred-cross-domain
status: shipped
type: refactor
notes: "RESOLVED 2026-06-19 by typed-test-fixtures-cross-domain-order-events. Was: ORDER_*/NormalizedOrderEvent cross-domain consumer fixtures — doubly blocked (flat detailType→schema registry collision + investor-ctrl fixtures fabricate fields NormalizedOrderEventSchema lacks). Both blockers cleared: ORDER_* registered in brokerCtrlEventSubjects (no collision — distinct from SIM_ORDER_*/ALPACA_ORDER_*), and the fixtures were retyped to the DRY NormalizedOrderEvent shape (fabricated symbol/side/quantity/fillPrice dropped). The entangled production forks (ledger-ctrl-live-tax-lot-missing-order-fields, broker-ctrl-order-sf-input-contract-gap) remain filed + open — the fixtures now match the real producer contract and the balance-value tests are attributed to those money bugs, per spec §2/§7 (test layer only)."
references:
  - docs/backlog/typed-test-fixtures-cross-domain-order-events.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Superseded by typed-test-fixtures-cross-domain-order-events (merged main 16edd2c5): ORDER_* registered (gate 88 events) + all ORDER_* fixtures typed; the deferral's two blockers no longer exist."
epic: typed-test-fixtures
epic_role: captured
---

# typed-test-fixtures — deferred ORDER_*/NormalizedOrderEvent family (blocked)

## Why this is `captured`, not `core` (2026-06-19 split)

This item originally bundled **two** classes of deferred cross-domain execution events under one
captured label — a closure-relevance **atomicity** violation. The migratable consumer fixtures
(ALPACA_ACCOUNT_SNAPSHOT, funding `DEPOSIT_SETTLED`/`WITHDRAWAL_SETTLED`, `BROKER_CIRCUIT_*`,
`CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`) **are** required for the epic's
`done_when` ("all ~290 putEvent sites migrated") and have been split out to
`[[typed-test-fixtures-cross-domain-consumer-migration]]` as **core**.

What remains here is only the `ORDER_*`/`NormalizedOrderEvent` family, which is **genuinely
orthogonal** to what the typed-test-fixtures epic can finish alone — it is doubly blocked on
out-of-scope production work, hence correctly `captured` + `parking`.

## The blocked family

`ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_ESCALATED`
(consumed cross-domain, e.g. investor-ctrl + ledger reconciliation).

- **Blocker (a) — registry collision.** `ORDER_REJECTED` collides on a flat `detailType→schema`
  registry: `execution-ctrl` models it as `OrderSchema` but `broker-ctrl` emits a
  `NormalizedOrderEventSchema` with a different shape; the registry cannot hold two schemas under
  the same detailType key without a source-discriminant.
- **Blocker (b) — entangled with parked production forks.** Cross-domain `ORDER_FILLED`/
  `ORDER_REJECTED` fixtures in investor-ctrl tests fabricate `{symbol, side, quantity, fillPrice}`
  that `NormalizedOrderEventSchema` does not carry. Fixing those fixtures requires resolving the
  parked production forks first (both `out_of_scope` for this epic — production contract changes):
  - `[[ledger-ctrl-live-tax-lot-missing-order-fields]]`
  - `[[broker-ctrl-order-sf-input-contract-gap]]`
- Explicitly out-of-scope in Phase 3 spec §9. See `TODO(typed-test-fixtures Phase 4)` comment in
  `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:116`.

## Promote when

The parked production forks `ledger-ctrl-live-tax-lot-missing-order-fields` and
`broker-ctrl-order-sf-input-contract-gap` are resolved (which also settles the registry
source-discriminant question), unblocking the `ORDER_*` fixture migration.
