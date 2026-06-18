---
id: typed-test-fixtures-phase3-execution
status: shipped
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Phase 3 of the typed-test-fixtures epic (spec §4): retrofit the EXECUTION domain test fixtures to the typed putEvent API. Add per-producer event→schema maps for the execution producers (execution-ctrl, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt; execution-hub is an EventBridge router with no handlers) and compose into EventSubjects. Migrate the domain's integration + e2e putEvent call-sites to subject/context, fix each co-wrong fixture (a) / file each latent contract bug (b) per spec §7, and extend the regression gate (spec §6) to execution fixtures. NOTE: the execution domain has several known producer minimal-shape gaps already parked (broker-ctrl-order-sf-input-contract-gap, ledger-ctrl-live-tax-lot-missing-order-fields, broker-alpaca-* drift items) — the retrofit will likely re-surface these as (b) latent bugs; reference, do not re-file duplicates."
done_when: "All execution-domain putEvent call-sites migrated to the typed subject/context API; execution producer event→schema maps exported + composed into EventSubjects; every compiler-surfaced co-wrong fixture corrected (a) or filed/cross-referenced (b); execution-domain integration + e2e suites green against deployed dev; the regression gate forbids untyped putEvent in execution fixtures."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - libs/test-contracts/src/index.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - services/execution
out_of_scope:
  - "Investor / Advisory / Ledger domain fixtures (Phases 1, 2, 4)"
  - "Fixing the known execution producer minimal-shape latent bugs (those are their own parked workstreams; the retrofit cross-references, it does not fix production code)"
  - "Production contract/producer/consumer changes (test layer only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: docs/superpowers/plans/2026-06-18-typed-test-fixtures-phase3-execution.md
topic_memory: [project_event_subject_contracts.md]
validation_gate: >-
  Static gate: `node tools/check-typed-fixtures.mjs` → OK (449 test file(s) scanned, 73 registered events) — +19 over the Phase 2 baseline of 54 (broker-sim 4: SIM_DEPOSIT_COMPLETED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_WITHDRAWAL_COMPLETED; broker-alpaca 10: ALPACA_ACCOUNT_CHECK, ALPACA_ORDER_CANCEL_FAILED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_PLACED, ALPACA_ORDER_REJECTED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_TRANSFER_INITIATED; broker-ctrl 5: ALPACA_ORDER_REQUESTED, ALPACA_TRANSFER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_ORDER_REQUESTED, SIM_WITHDRAWAL_REQUESTED). test-contracts: 2/2 PASS (registry sync + name list). Lint: 0 errors across all 5 projects (broker-sim-adpt, broker-alpaca-adpt, broker-ctrl, test-contracts, e2e-feature-tests; pre-existing warnings only). tsc no-new-errors: broker-sim-adpt 1 pre-existing error (event-listener.test.ts TS1117), broker-alpaca-adpt 14 pre-existing errors (event-listener.ts + unit tests), broker-ctrl 6 pre-existing errors (callback-resolver.ts branded EventName), e2e-feature-tests 0 errors — ZERO errors in any branch-touched file; one new tsc error introduced during Task 4 migration (broker-alpaca-adpt.resilience.integration.test.ts direction:string vs 'INCOMING'|'OUTGOING') fixed in Task 6 by adding `as const`. (a)=3 co-wrong fixtures fixed: ALPACA_TRANSFER_REQUESTED e2e amount→amountCents+currency (Task 4), SIM_WITHDRAWAL_REQUESTED amount→amountCents+direction+currency in integration + e2e (Task 4), SIM_DEPOSIT_INITIATED missing direction field in integration + e2e (Task 4). (b)=4 latent contract bugs filed: typed-test-fixtures-execution-deferred-cross-domain (deferred cross-domain event families), route-order-userid-in-subject-nondry (broker-ctrl DRY violation), broker-sim-inbound-schemas-nondry-stale (dead amount field), account-closure-requested-never-emitted (no production emitter). Deferred set tracked in `typed-test-fixtures-execution-deferred-cross-domain` (ALPACA_ACCOUNT_SNAPSHOT, DEPOSIT_*/WITHDRAWAL_*, BROKER_CIRCUIT_*, ORDER_*/NormalizedOrderEvent). Deployed-dev runtime owned by typed-test-fixtures-consolidated-integration-e2e-verify (program decoupling decision).
---

# Phase 3 — Execution domain fixture retrofit

The third domain retrofit wave (spec §4). Migrate the **Execution** domain's fixtures
(execution-ctrl, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt) to the typed `putEvent` API
so a co-wrong execution fixture becomes a compile error.

This domain has several already-parked producer minimal-shape gaps (e.g.
`broker-ctrl-order-sf-input-contract-gap`, `ledger-ctrl-live-tax-lot-missing-order-fields`,
the `broker-alpaca-*` drift items). The typed migration will likely re-surface these as (b)
latent contract bugs — cross-reference the existing items rather than re-filing duplicates;
this program changes no production code (spec §2 non-goals). Verify fixture-touching lint with
`--skip-nx-cache` (spec §5 CORRECTION).
