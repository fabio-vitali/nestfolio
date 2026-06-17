---
id: typed-test-fixtures-phase2-advisory
status: shipped
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
validation_gate: "Shipped 2026-06-18 on branch worktree-typed-fixtures-phase2-advisory (8 slices, commits 6cdce32c..0a85df0c). STATIC GATES (runtime decoupled to typed-test-fixtures-consolidated-integration-e2e-verify): tools/check-typed-fixtures.mjs → OK (449 test files, 54 registered events, 18→54 = +36 advisory events); test-contracts 2/2 (registry name-source sync + parse backstop); affected test+lint over 32 projects → NX Successfully ran (unit suites only; integration is the decoupled test-integration target); per-task review clean ×8 + opus whole-branch review = Ready to merge (0 Critical/0 Important). Migrated ~77 advisory putEvent call-sites (incl. cross-domain execution-ctrl/dashboard-bff/ledger-ctrl sites emitting advisory events) detail→subject/context. Mechanism added: EventBridgeClient.putRawEvent (raw unvalidated send for intentional negative tests). 6 (b) latent contract bugs filed (captured): dwc-decision-packet-schema-missing-optional-fields, ledger-ctrl-decision-packet-fixture-thin-shape, dashboard-bff-decision-blocked-reason-field-mismatch, dwc-sf-command-subject-tenantid-nondry, yahoo-finance-mi-ctrl-subject-region-dead-code, sec-prospectus-pe-ctrl-fixture-contract-mismatch; typed-fixtures-negative-test-invalid-payload dropped (resolved by putRawEvent). ONE user-approved production change rode along (Task 1): DecisionPacketSchema +3 optional fields (taskToken/confirmedAt/rejectedAt) it was stripping from CDC → confirm/reject flow fix; its runtime validation is owed to consolidated-verify. NOTE: done_when's 'integration+e2e green against deployed dev' is intentionally satisfied by the decoupled consolidated-verify member per the epic's decoupled-runtime decision, NOT in this phase."
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
