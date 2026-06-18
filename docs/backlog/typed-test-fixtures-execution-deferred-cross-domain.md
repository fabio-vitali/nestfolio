---
id: typed-test-fixtures-execution-deferred-cross-domain
status: parking
type: refactor
notes: "Phase 3 (execution) deferred the execution-produced events whose consumer fixtures live in OTHER domains' test files — ALPACA_ACCOUNT_SNAPSHOT (ledger reconciliation), funding DEPOSIT_*/WITHDRAWAL_* (investor/advisory/ledger), BROKER_CIRCUIT_* (investor) — plus the blocked ORDER_*/NormalizedOrderEvent family. Register + migrate in the consuming-domain (Phase 4 / ledger) wave once the parked ledger-tax-lot / order-sf production forks resolve."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# typed-test-fixtures Phase 3 — deferred cross-domain execution events

## Context (2026-06-18)

Phase 3 (execution) was intentionally scoped to the execution domain's own test files. Events whose consumer fixtures live in other domains' test files were excluded from this wave to keep the blast radius clean and avoid entangling the execution wave with ledger/investor/advisory fixture migrations.

## Deferred event families

### ALPACA_ACCOUNT_SNAPSHOT
- Produced by `broker-alpaca-adpt`; consumed in ledger reconciliation fixtures.
- Consumer test files live in `services/ledger/`.
- Defer to Phase 4 (ledger wave).

### Funding events: DEPOSIT_* / WITHDRAWAL_*
- `DEPOSIT_INITIATED`, `DEPOSIT_COMPLETED`, `WITHDRAWAL_INITIATED`, `WITHDRAWAL_SETTLED`, etc.
- Produced by execution-domain services; consumed in investor/advisory/ledger test files.
- Defer to the consuming-domain wave for each.

### Circuit-breaker events: BROKER_CIRCUIT_*
- `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED`
- Produced by `broker-ctrl`; consumed in investor-ctrl (`onboarding-notification.integration.test.ts`).
- Defer to investor-domain wave (Phase 4 or a dedicated circuit-breaker fixture pass).

### ORDER_* / NormalizedOrderEvent family (doubly blocked)
- `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_ESCALATED` are consumed cross-domain.
- **Blocker (a):** `ORDER_REJECTED` collides on a flat `detailType→schema` registry — `execution-ctrl` models it as `OrderSchema` but `broker-ctrl` emits a `NormalizedOrderEventSchema` with a different shape; the registry cannot hold two schemas under the same detailType key without a source-discriminant.
- **Blocker (b):** Cross-domain `ORDER_FILLED`/`ORDER_REJECTED` fixtures in investor-ctrl tests fabricate `{symbol, side, quantity, fillPrice}` that `NormalizedOrderEventSchema` does not carry — fixing those fixtures is entangled with the parked production forks:
  - `[[ledger-ctrl-live-tax-lot-missing-order-fields]]`
  - `[[broker-ctrl-order-sf-input-contract-gap]]`
- These were explicitly out-of-scope in Phase 3 spec §9. See `TODO(typed-test-fixtures Phase 4)` comment in `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:116`.

## Promote when

Starting Phase 4 (ledger domain wave), OR when the parked production forks `ledger-ctrl-live-tax-lot-missing-order-fields` and `broker-ctrl-order-sf-input-contract-gap` are resolved, whichever comes first.
