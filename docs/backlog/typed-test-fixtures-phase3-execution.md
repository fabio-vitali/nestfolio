---
id: typed-test-fixtures-phase3-execution
status: active
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
validation_gate: null
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
