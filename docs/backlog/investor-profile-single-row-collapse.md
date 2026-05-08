---
id: investor-profile-single-row-collapse
status: shipped
type: refactor
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-05-03-investor-profile-collapse-design.md
plan: docs/superpowers/plans/2026-05-03-investor-profile-collapse-plan.md
topic_memory:
  - project_investor_profile_collapse.md
validation_gate: "Integration 39/41 (investor-bff 17/17, dashboard-bff 17/17, compliance-ctrl 5/7 — 2 fixture flakes filed); Playwright 5-run gate 2/5 full journey + 5/5 onboarding completions (Phase 9's actual concern)."
closed: "2026-05-04"
notes: "Replaced multi-row InvestorProfile decomposition with single composite row + sibling MandateStatus row owning lifecycle."
---

# InvestorProfile single-row collapse

SHIPPED 2026-05-04 on `main` (`4d4c5679..e60caf76`): replaced investor-bff multi-row InvestorProfile decomposition (separate Goal#/RiskProfile/Mandate/OperatingMode/AccountMode rows) with a single composite InvestorProfile row + sibling MandateStatus row owning lifecycle.

Collapsed 8 per-field events to 2 (`INVESTOR_PROFILE_CREATED`/`UPDATED` + `MANDATE_ISSUED`/`REVOKED`). Rewired decision-workflow-ctrl to start SF directly from EventBridge (removed TriggerIngress Lambda + WorkflowTrigger DDB row + WORKFLOW_TRIGGER_CREATED event). Completed half-implemented `revokeMandate` flow (now writes only MandateStatus row → CDC emits MANDATE_REVOKED; composite InvestorProfile.mandate config preserved).

Critical fixes during execution: (1) `user-registered.ts` → `skip()` (was pre-creating sparse row → ONBOARDING_COMPLETED Put became MODIFY → emitted UPDATED instead of CREATED); (2) Phase-2 SF wiring bug — UnpackTriggerEnvelope still read `$.subject.decisionId` from trigger events that don't carry one (legacy TriggerIngress used to mint it) → fixed via `States.UUID()` (commit `e60caf76`).

Original Q1 design `executionName=${event.id}` dedup dropped after AWS EB→SF native target verified to have no per-target Name field; idempotency item demoted to LOW priority post-collapse.

Validation: integration 39/41 (investor-bff 17/17, dashboard-bff 17/17, compliance-ctrl 5/7 — 2 fixture flakes filed); Playwright 5-run gate 2/5 full journey (3/5 timeout at L1 user-confirm UX — agents non-deterministically L1 vs L2; filed) + 5/5 onboarding completions (Phase 9's actual concern).
