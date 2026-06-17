---
id: typed-test-fixtures-phase1-investor
status: shipped
rank: 1
type: refactor
epic: typed-test-fixtures
epic_role: core
notes: "Phase 1 of the typed-test-fixtures epic (spec §4): retrofit the INVESTOR domain's test fixtures to the typed putEvent API. Add per-producer event→schema maps for the investor producers (investor-bff: MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED / MANDATE_REAFFIRMED / INVESTOR_PROFILE_UPDATED …; onboarding-bff: ONBOARDING_COMPLETED; investor-ctrl; investor-adpt; dashboard-bff) co-located in each producer's /contracts and composed into @nestfolio/test-contracts' EventSubjects registry. Migrate every investor-domain integration + e2e putEvent({ detail }) call-site to putEvent({ subject: SubjectOf<K>, context? }), fixing each co-wrong fixture the compiler surfaces. Add the per-domain regression gate (spec §6) forbidding raw/untyped putEvent in investor fixtures. Log the count + (a)fixture-only / (b)latent-contract-bug split (spec §7); file every (b) via backlog-add — no production code changes here."
done_when: "All investor-domain putEvent call-sites (integration + e2e) migrated to the typed subject/context API; investor producer event→schema maps exported via @nestfolio/<svc>/contracts and composed into EventSubjects; every compiler-surfaced co-wrong fixture corrected (a) or filed (b); per-domain regression gate forbids untyped putEvent in investor fixtures. (Full investor-domain integration + e2e green-against-deployed-dev DECOUPLED to typed-test-fixtures-consolidated-integration-e2e-verify per 2026-06-17 user direction — shipped on static gates + healthy-window integration evidence due to a degraded dev-env CDC/EB propagation flake at ship time.)"
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - libs/test-contracts/src/index.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - services/investor
out_of_scope:
  - "Advisory / Execution / Ledger domain fixtures (Phases 2-4)"
  - "Production contract/producer/consumer changes (test layer only); latent contract bugs surfaced are filed separately (spec §7)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: docs/superpowers/plans/2026-06-17-typed-test-fixtures-phase1-investor.md
topic_memory: [project_event_subject_contracts.md]
validation_gate: |
  SHIPPED 2026-06-17 (merged to main, fast-forward; impl commits d0e42726..21c0e62d). Test-layer
  only — no production behavior changed (final holistic review confirmed: 27 files, additive inert
  *EventSubjects maps consumed only by @nestfolio/test-contracts; no handler/resolver/CDC/schema edits).
  MECHANISM: 4 investor producer event→schema maps (investorBffEventSubjects, onboardingBffEventSubjects,
  investorCtrlEventSubjects, investorFundingEventSubjects) + mandateEventSubjects composed into the
  18-name EventSubjects registry; registry pin-test + JSON↔registry sync test (2/2).
  MIGRATION: every registered-investor-event putEvent call-site migrated to typed subject/context across
  the shared e2e fixtures, investor-bff/dashboard-bff/investor-ctrl integration tests, 1 e2e scenario,
  and (per the registry-driven gate's repo-wide scope) the cross-domain decision-workflow-ctrl /
  investor-profile-ctrl / broker-ctrl integration tests. (a) co-wrong fixes incl. MANDATE_ISSUED excess
  guardrail fields, INVESTOR_PROFILE_UPDATED accountMode/mandate wrapper, goalType→objective, band
  string→object. (b) latents: 0 new (3 pre-existing side-findings filed: investor-services-latent-tsc-errors,
  investor-web-event-contracts-surface, investor-bff-stale-onboarding-completed-schema).
  GATE: tools/check-typed-fixtures.mjs reworked to registry-driven (forbids legacy detail: for any
  registered event repo-wide) — GREEN (exit 0, 451 files). REVIEWS: 5 per-task spec+quality reviews +
  1 final holistic review, all approved.
  STATIC GATES ON MAIN (all green): tsc --noEmit (test-contracts, e2e clean; 6 services no-new-errors vs
  baseline); nx lint+test for 10 changed projects "Successfully ran" (incl. registry tests, circular-dep
  handled); the typed-fixtures gate exit 0.
  RUNTIME (deployed dev): migrated-fixture paths PROVEN — dashboard-bff integration 21/21 (migrated
  INVESTOR_PROFILE_CREATED/UPDATED → snapshot materialized + CDC) + broker-ctrl 11/11 (migrated
  DEPOSIT_INITIATED/WITHDRAWAL_INITIATED/EXECUTION_MODE_CHANGED). Zero ZodError/parse failures across the
  whole integration run (a malformed migrated subject would ZodError→DLQ — none did). The remaining
  integration failures (investor-bff 1, investor-ctrl 15, decision-workflow-ctrl 6, investor-profile-ctrl 1)
  are an EventBusTrap timeout-empty-buffer dev-env CDC/EB propagation degradation (1939s suite runtimes),
  hitting UNMIGRATED events (DECISION_APPROVED, ORDER_FILLED, PORTFOLIO_COMPLETED, BROKER_CIRCUIT_*)
  IDENTICALLY — NOT a Phase 1 regression. Matches filed pre-existing flakes: integration-deep-coldstart-
  flakes-post-trap-hardening, ip-ctrl-integration-snapshot-userid-mismatch (the deterministic
  investor-profile-ctrl 'materialises' failure, reproduced 2/2), investor-bff-updateoperatingmode-
  integration-seed-flake.
  DECOUPLED VERIFY (2026-06-17 user direction): full investor-domain integration + e2e green-against-dev
  is consolidated into typed-test-fixtures-consolidated-integration-e2e-verify (run once all phases land +
  the dev-env propagation recovers). The epic is NOT drainable until that consolidated verification is green.
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
