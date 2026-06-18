---
id: typed-test-fixtures-cross-domain-consumer-migration
status: queued
rank: 3
type: refactor
notes: "CORE. Register + migrate the execution-produced events whose CONSUMER fixtures live in other domains' test files and that have a usable producer contract: ALPACA_ACCOUNT_SNAPSHOT, DEPOSIT_SETTLED/WITHDRAWAL_SETTLED, BROKER_CIRCUIT_*, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED. Their consumer putEvent({detail}) sites remain legacy/gate-invisible after Phase 4 — required for done_when 'all ~290 sites migrated'. Split out 2026-06-19 from typed-test-fixtures-execution-deferred-cross-domain (which keeps only the blocked ORDER_* family)."
references: []
out_of_scope:
  - "ORDER_*/NormalizedOrderEvent family — doubly blocked, stays in [[typed-test-fixtures-execution-deferred-cross-domain]]"
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

| Event | Producer | Consumer test files |
| --- | --- | --- |
| `ALPACA_ACCOUNT_SNAPSHOT` | `broker-alpaca-adpt` | `services/ledger/` reconciliation |
| `DEPOSIT_SETTLED` / `WITHDRAWAL_SETTLED` | execution funding services | investor / advisory / ledger |
| `BROKER_CIRCUIT_OPEN` / `_CLOSED` / `BROKER_HEAL_ESCALATED` | `broker-ctrl` | investor-ctrl `onboarding-notification.integration.test.ts` |
| `CORPORATE_ACTION_APPLIED` | execution | ledger |
| `PORTFOLIO_SNAPSHOT_IMPORTED` | execution | ledger |

## Done when

Each event above is registered in the typed-fixtures `EventSubjects` registry against its real
producer contract, and every consumer `putEvent({ detail })` site that injects it is migrated to
the typed `subject:` form (so `check-typed-fixtures` no longer reports them as legacy/skipped).
Verify against the real producers per the [[event-subject-contracts]] lesson (e2e, not fixtures).
