---
id: typed-test-fixtures-phase2-advisory
status: active
rank: 2
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Phase 2 of the typed-test-fixtures epic (spec §4): retrofit the remaining ADVISORY domain test fixtures to the typed putEvent API. compliance-ctrl was already migrated in Phase 0 and decisionWorkflowEventSubjects already exists — this wave covers the rest: decision-workflow-ctrl (remaining), advisory-bff, advisory-adpt, and the 4 LangGraph agent services (investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl). Add each remaining advisory producer's event→schema map, compose into EventSubjects, migrate that domain's integration + e2e putEvent call-sites to subject/context, fix each co-wrong fixture (a) / file each latent contract bug (b) per spec §7, and extend the regression gate (spec §6) to advisory fixtures."
done_when: "All remaining advisory-domain putEvent call-sites migrated to the typed subject/context API; remaining advisory producer event→schema maps exported + composed into EventSubjects; every compiler-surfaced co-wrong fixture corrected (a) or filed (b); advisory-domain integration + e2e suites green against deployed dev; the regression gate forbids untyped putEvent in advisory fixtures."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - libs/test-contracts/src/index.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - services/advisory
out_of_scope:
  - "compliance-ctrl fixtures (already migrated in Phase 0)"
  - "Investor / Execution / Ledger domain fixtures (Phases 1, 3, 4)"
  - "Production contract/producer/consumer changes (test layer only); latent contract bugs surfaced are filed separately (spec §7)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: docs/superpowers/plans/2026-06-17-typed-test-fixtures-phase2-advisory.md
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Phase 2 — Advisory domain fixture retrofit (remaining services)

The second domain retrofit wave (spec §4). compliance-ctrl + `decisionWorkflowEventSubjects`
landed in Phase 0; this wave migrates the rest of the advisory domain's fixtures (advisory-bff,
advisory-adpt, decision-workflow-ctrl residuals, and the 4 agent services) to the typed
`putEvent` API so a co-wrong advisory fixture becomes a compile error.

Per spec §4/§6/§7: add the remaining producer event→schema maps, migrate fixtures, fix (a) /
file (b) surfaced co-wrong fixtures, extend the per-domain regression gate. Verify
fixture-touching lint with `--skip-nx-cache` (spec §5 CORRECTION — nx cache masks the test-only
circular dependency).
