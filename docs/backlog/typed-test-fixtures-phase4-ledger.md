---
id: typed-test-fixtures-phase4-ledger
status: active
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Phase 4 (final) of the typed-test-fixtures epic (spec §4): retrofit the LEDGER domain test fixtures to the typed putEvent API. Add per-producer event→schema maps for the ledger producers (ledger-ctrl, ledger-bff, ledger-adpt, reconciliation-ctrl) and compose into EventSubjects. Migrate the domain's integration + e2e putEvent call-sites to subject/context, fix each co-wrong fixture (a) / file each latent contract bug (b) per spec §7, and extend the regression gate (spec §6) to ledger fixtures. On completion of this wave the ~290 putEvent call-sites across all 4 domains are migrated, the per-domain gate is workspace-wide, and the epic's done_when is satisfiable (ship the epic)."
done_when: "All ledger-domain putEvent call-sites migrated to the typed subject/context API; ledger producer event→schema maps exported + composed into EventSubjects; every compiler-surfaced co-wrong fixture corrected (a) or filed (b); ledger-domain integration + e2e suites green against deployed dev; the regression gate forbids untyped putEvent in ledger fixtures; with all 4 domains migrated, the untyped-putEvent gate is workspace-wide."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - libs/test-contracts/src/index.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - services/ledger
out_of_scope:
  - "Investor / Advisory / Execution domain fixtures (Phases 1-3)"
  - "ledger-ctrl-live-tax-lot-missing-order-fields production fix (a genuine producer/consumer fork owned by typed-subject-consumer-contract-gaps; the retrofit cross-references the latent bug, does not fix it)"
  - "Production contract/producer/consumer changes (test layer only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Phase 4 — Ledger domain fixture retrofit (final wave)

The final domain retrofit wave (spec §4). Migrate the **Ledger** domain's fixtures (ledger-ctrl,
ledger-bff, ledger-adpt, reconciliation-ctrl) to the typed `putEvent` API so a co-wrong ledger
fixture becomes a compile error.

On completion, all ~290 `putEvent` call-sites across the 4 domains are migrated and the
untyped-`putEvent` regression gate is workspace-wide — satisfying the epic's `done_when`, at
which point the `typed-test-fixtures` epic itself is shippable.

Note the parked `ledger-ctrl-live-tax-lot-missing-order-fields` (a genuine producer/consumer
fork owned by `typed-subject-consumer-contract-gaps`) may re-surface here as a (b) latent bug —
cross-reference it; this program changes no production code (spec §2 non-goals). Verify
fixture-touching lint with `--skip-nx-cache` (spec §5 CORRECTION).
