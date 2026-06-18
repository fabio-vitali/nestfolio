---
id: typed-test-fixtures-cross-domain-consumer-migration
status: active
type: refactor
notes: "CORE. Register + migrate the execution-produced events whose CONSUMER fixtures live in other domains' test files and that have a usable producer contract: ALPACA_ACCOUNT_SNAPSHOT, DEPOSIT_SETTLED/WITHDRAWAL_SETTLED, BROKER_CIRCUIT_OPEN/CLOSED, BROKER_HEAL_ESCALATED. Their consumer putEvent({detail}) sites remain legacy/gate-invisible after Phase 4 — required for done_when 'all ~290 sites migrated'. Split out 2026-06-19 from typed-test-fixtures-execution-deferred-cross-domain (ORDER_* family) and again 2026-06-19 from CORPORATE_ACTION_APPLIED/PORTFOLIO_SNAPSHOT_IMPORTED (no producer contract)."
references: []
out_of_scope:
  - "ORDER_*/NormalizedOrderEvent family — doubly blocked, stays in [[typed-test-fixtures-execution-deferred-cross-domain]]"
  - "CORPORATE_ACTION_APPLIED + PORTFOLIO_SNAPSHOT_IMPORTED — no producer zod contract/emitter, can't be typed test-layer-only; split to [[corporate-action-portfolio-snapshot-no-producer-contract]]"
  - "Producer/consumer/registry production changes — test-layer migration only (per epic out_of_scope)"
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: typed-test-fixtures
epic_role: core
---

# typed-test-fixtures — cross-domain consumer fixture migration (core)

The migratable half of the former `[[typed-test-fixtures-execution-deferred-cross-domain]]` item.
These are execution-produced events whose **consumer** fixtures live in ledger/investor/advisory
test files; Phase 3 (execution) deferred them to keep the wave's blast radius clean, and Phase 4
(ledger) registered only ledger-**produced** events, so these consumer sites still emit via legacy
untyped `putEvent({ detail })` and are gate-invisible.

They are **core**: leaving them un-migrated falsifies the epic's `done_when` clause *"all ~290
putEvent call-sites across the 4 domains migrated to the typed API"*. Each has a usable
producer-owned contract, so it is typeable now (unlike the `ORDER_*` family, which is blocked).

## Events to register + migrate

All 6 have a producer-owned zod schema that is defined but **not yet registered** in the producer's
local `*EventSubjects` map (verified 2026-06-19). The 2 originally-listed events with **no producer
contract** (`CORPORATE_ACTION_APPLIED`, `PORTFOLIO_SNAPSHOT_IMPORTED`) were split out to
[[corporate-action-portfolio-snapshot-no-producer-contract]].

| Event | Producer schema (file:line) | Consumer legacy call sites |
| --- | --- | --- |
| `ALPACA_ACCOUNT_SNAPSHOT` | `AlpacaAccountSnapshotSchema` — `broker-alpaca-adpt/src/domain/contracts.ts:28` | `reconciliation-ctrl` unit + integration |
| `DEPOSIT_SETTLED` | `FundingSnapshotSchema` (verify real producer: broker-ctrl vs execution-adpt) | `ledger-ctrl`, `investor-bff` |
| `WITHDRAWAL_SETTLED` | `FundingSnapshotSchema` (same — verify producer home) | `ledger-ctrl`, `investor-bff`, `investor-ctrl` |
| `BROKER_CIRCUIT_OPEN` | `BrokerCircuitEventSchema` — `broker-alpaca-adpt/src/domain/contracts.ts:43` | `investor-bff`, `investor-ctrl` |
| `BROKER_CIRCUIT_CLOSED` | `BrokerCircuitEventSchema` (same) | `investor-bff`, `investor-ctrl` |
| `BROKER_HEAL_ESCALATED` | `BrokerCircuitEventSchema` (same) | `investor-ctrl` |

⚠ `BROKER_CIRCUIT_*` schemas live in `broker-alpaca-adpt` while the item title said `broker-ctrl` —
confirm the **real producer** of each circuit event before registering (event-subject-contracts
lesson: register against the actual emitter's contract). Same for `DEPOSIT/WITHDRAWAL_SETTLED`
(schema found in `execution-adpt/src/domain/contracts.ts:17`, item said broker-ctrl producer).

## Done when

Each event above is registered in the typed-fixtures `EventSubjects` registry against its real
producer contract, and every consumer `putEvent({ detail })` site that injects it is migrated to
the typed `subject:` form (so `check-typed-fixtures` no longer reports them as legacy/skipped).
Verify against the real producers per the [[event-subject-contracts]] lesson (e2e, not fixtures).
