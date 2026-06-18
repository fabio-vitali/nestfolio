---
id: typed-test-fixtures-phase4-ledger
status: shipped
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
plan: docs/superpowers/plans/2026-06-18-typed-test-fixtures-phase4-ledger.md
topic_memory: [project_event_subject_contracts.md]
validation_gate: >-
  Static gates GREEN (deployed-dev runtime decoupled to typed-test-fixtures-consolidated-integration-e2e-verify
  per the 2026-06-17 program decision). Full producer-wave migration (2026-06-18 user decision): registered the
  4 ledger-PRODUCED events and migrated every fixture that injects them across 4 domains + the shared e2e funded()
  helper. Commits: 3b560b41 (BALANCE_UPDATED, 10 sites), 0958e22e (PORTFOLIO_UPDATED, 14 sites incl. the
  reconciliation array→record reshape), dcf06578 (LEDGER_ENTRY_RECORDED, 6 sites), 6e8b0774 (RECONCILIATION_COMPLETED,
  1 site). Gate: `node tools/check-typed-fixtures.mjs` → OK (449 test files, 77 registered events — +4 over the Phase-3
  baseline of 73: BALANCE_UPDATED, LEDGER_ENTRY_RECORDED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED). test-contracts
  registry test 2/2 (map ⟺ JSON ⟺ EXPECTED quadruple-sync at 77 names). tsc: 0 NEW errors across every touched project
  (ledger-ctrl/reconciliation-ctrl/ledger-bff/investor-bff/dashboard-bff/decision-workflow-ctrl/test-contracts/e2e —
  pre-existing latent errors per investor-services-latent-tsc-errors tolerated). Lint clean on all touched projects
  (per-task). Closing verify `nx run-many -t test,lint -p ledger-ctrl,reconciliation-ctrl,test-contracts` → 18 suites /
  116 unit tests + lint PASS (proportionate scope: the 32-project nx-affected set is the libs/test-contracts shared-test-lib
  artifact; my change is additive test-fixture maps that can only break the projects whose code changed; integration/e2e
  files are test-integration-target only and decoupled). Final whole-branch review (opus): ✅ ready to merge — registry
  integrity verified, the reconciliation reshape proven behavior-preserving against the real handler (normalizePositions
  reads only symbol+quantity; reconciliationId is content-derived and quantities were preserved per site), no identity in
  any subject, production boundary respected (only the 2 contracts.ts map appends). (a)=14 co-wrong fixtures fixed
  (deltaCents ×2; reconciliation array→record ×6 — these were silently red against deployed dev, Bug-A class, now corrected;
  dashboard PORTFOLIO_UPDATED positions/cashBalanceCents ×2 + read-model-projection ×1; dashboard LEDGER_ENTRY_RECORDED
  entryType ×2; dashboard RECONCILIATION_COMPLETED ×1). Deferrals: PORTFOLIO_DRIFT_DETECTED registry name-collision
  (portfolio-drift-detected-registry-collision, captured) + the execution-CONSUMED events kept deferred
  (typed-test-fixtures-execution-deferred-cross-domain, per user decision). Final-review finding filed:
  check-typed-fixtures-dynamic-detailtype-gap (captured). Deploy: NONE — test-layer only; the contracts.ts maps are
  tree-shaken test-only exports (detect-deploy's 28-service flag is a shared-test-lib false-positive). With all 4 domains
  migrated, the untyped-putEvent regression gate is workspace-wide (modulo the documented deferrals); the typed-test-fixtures
  epic's core members are all terminal except the consolidated-verify gate → epic is now drainable pending that runtime proof.
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
