---
id: investor-services-latent-tsc-errors
status: parking
type: bug
notes: "Surfaced 2026-06-17 by typed-test-fixtures Phase 1 (Investor). A real `tsc --noEmit -p services/<svc>/tsconfig.json` reports PRE-EXISTING type errors that the `test` target masks because ts-jest runs with diagnostics:false (+ esbuild bundling, not tsc), so type errors never fail unit/integration tests or the nx pipeline. Same class as the existing broker-alpaca-adpt-latent-tsc-errors (that one is 1 service; this is the wider investor/advisory/execution surface). Counts at time of filing: investor-bff 27, dashboard-bff 12, investor-ctrl 10, decision-workflow-ctrl 10, investor-profile-ctrl 2, broker-ctrl 6 — in src handlers/repositories AND test files (e.g. investor-ctrl resilience uses `createTestContext` where the real export is `createIntegrationTestContext`; dashboard-bff/investor-bff repos have TableEntry `version`/TenantId mismatches; onboarding-completed.ts transform errors). NONE are e2e-blocking and NONE were introduced by Phase 1 (verified: the typed-fixture migration's per-service tsc error count was unchanged before/after). Consequence: the compile-time safety the typed-subject + typed-test-fixtures programs are meant to provide is partially UNDERMINED for these services until the latent errors are cleared AND a tsc gate is added (today only the runtime parseSubject backstop + the pure-Node check-typed-fixtures gate enforce shape; tsc itself is not gated). Fix: clear the per-service latent errors then add a `typecheck` (tsc --noEmit) target to the nx pipeline for these services (some services already have a `typecheck` target for read-model-ownership type-tests — extend it). Likely belongs in a workspace-wide 'diagnostics:false masks tsc' theme epic alongside broker-alpaca-adpt-latent-tsc-errors. Promote when hardening the type-safety gate or doing a tsc-cleanup sweep."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Investor/advisory/execution service unit+integration suites mask tsc errors (diagnostics:false)

`tsc --noEmit` against several services' `tsconfig.json` reports pre-existing type errors that
the `test` target never surfaces because ts-jest is configured with `diagnostics: false` and
the deploy bundle is built by esbuild (no full typecheck). So these services compile "green"
in CI/nx while carrying real type errors.

Surfaced while validating typed-test-fixtures Phase 1 (the migration's tsc-diff validation had
to be expressed as "no NEW errors vs baseline" rather than "exit 0" because of this). The
typed-fixture migration introduced **zero** new errors — every error here is pre-existing.

This is the same root cause as [[broker-alpaca-adpt-latent-tsc-errors]] (that item is scoped to
one service). Candidate for a shared "diagnostics:false masks tsc" theme epic + a real
`typecheck` nx target per service so the typed-subject / typed-test-fixtures compile-time
guarantees actually bind.

**Extended 2026-06-19** (typed-test-fixtures cross-domain consumer migration): the LEDGER domain is
also affected (this item's title says investor/advisory/execution, but the class is workspace-wide) —
`reconciliation-ctrl` 26 (src handlers/repositories/services + `test/unit/reconciliation.service.test.ts`)
and `ledger-ctrl` 5 (`test/unit/transforms/snapshot-to-events.test.ts`). Confirmed pre-existing: the
cross-domain fixture migration added **zero** new errors to either (the migrated integration/e2e files
compile clean). Reinforces that the shared theme epic should span all 4 domains.
