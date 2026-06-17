---
id: typed-test-fixtures-phase1-investor
status: active
rank: 1
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Phase 1 of the typed-test-fixtures epic (spec §4): retrofit the INVESTOR domain's test fixtures to the typed putEvent API. Add per-producer event→schema maps for the investor producers (investor-bff: MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED / MANDATE_REAFFIRMED / INVESTOR_PROFILE_UPDATED …; onboarding-bff: ONBOARDING_COMPLETED; investor-ctrl; investor-adpt; dashboard-bff) co-located in each producer's /contracts and composed into @nestfolio/test-contracts' EventSubjects registry. Migrate every investor-domain integration + e2e putEvent({ detail }) call-site to putEvent({ subject: SubjectOf<K>, context? }), fixing each co-wrong fixture the compiler surfaces. Add the per-domain regression gate (spec §6) forbidding raw/untyped putEvent in investor fixtures. Log the count + (a)fixture-only / (b)latent-contract-bug split (spec §7); file every (b) via backlog-add — no production code changes here."
done_when: "All investor-domain putEvent call-sites (integration + e2e) migrated to the typed subject/context API; investor producer event→schema maps exported via @nestfolio/<svc>/contracts and composed into EventSubjects; every compiler-surfaced co-wrong fixture corrected (a) or filed (b); investor-domain integration + e2e suites green against deployed dev; per-domain regression gate forbids untyped putEvent in investor fixtures."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - libs/test-contracts/src/index.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - services/investor
out_of_scope:
  - "Advisory / Execution / Ledger domain fixtures (Phases 2-4)"
  - "Production contract/producer/consumer changes (test layer only); latent contract bugs surfaced are filed separately (spec §7)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Phase 1 — Investor domain fixture retrofit

The first domain retrofit wave of the typed-test-fixtures epic (spec §4). With the Phase 0
mechanism in place (`@nestfolio/test-contracts` `EventSubjects` registry, typed `putEvent`
overload + runtime parse backstop, typed `TableAssertions`), migrate the **Investor** domain's
fixtures to the typed API so a co-wrong investor fixture becomes a compile error.

Per spec §4, each wave: add that domain's producer event→schema maps, migrate its fixtures to
the typed API, and fix every co-wrong fixture the compiler surfaces; per §6 add the per-domain
regression gate; per §7 log the (a)/(b) bug split and file each latent (b) separately.

Verify fixture-touching lint with `--skip-nx-cache` (the nx cache masked the Phase 0 test-only
circular-dependency; spec §5 CORRECTION).
