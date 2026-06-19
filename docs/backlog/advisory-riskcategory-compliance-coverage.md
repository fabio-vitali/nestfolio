---
id: advisory-riskcategory-compliance-coverage
status: parking
type: bug
notes: "Surfaced 2026-06-10 by typed-subject-contracts-advisory. The slice fixed a latent bug: decision-workflow-ctrl/assemble-packet.ts read `investorProfile?.riskCategory` at a wrong top-level path (the real IP agentOutput is composite {goals, risk, …}, riskCategory lives at .risk.riskCategory), so riskCategory was ALWAYS undefined→'MODERATE' in production. The fix (now deployed to dev + merged) reads `investorProfile?.risk?.riskCategory`, so the decision pipeline now flows the REAL risk category (CONSERVATIVE/AGGRESSIVE) into the DecisionPacket → RECOMMENDATION_PROPOSED → compliance-ctrl ComplianceInput.riskCategory → suitability checks. The advisory-contract-emission e2e gate confirmed the cycle still completes (7/7), but there is NO test asserting that a CONSERVATIVE or AGGRESSIVE investor produces the correct (and now newly-reachable) compliance suitability outcome. This is a behavior change to a previously-dead code path. Add coverage: (1) a compliance-ctrl/decision-cycle test that a non-MODERATE riskCategory drives the expected suitability check result, (2) confirm no dormant compliance rule keyed on riskCategory now fires unexpectedly for existing tenants. Promote before relying on risk-category-sensitive compliance behavior, or when adding compliance suitability tests."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: integration-coverage-backfill
epic_role: core
---

# Add coverage for the newly-real riskCategory → compliance path

The advisory typed-subject slice corrected `assemble-packet.ts` to read the real
`investorProfile.risk.riskCategory` (it had been reading a wrong path → always `'MODERATE'`).
Risk category now genuinely flows into compliance suitability checks for the first time. The
e2e gate proved the cycle still completes, but no test asserts the *outcome* for a
CONSERVATIVE/AGGRESSIVE investor, and no check confirms a dormant riskCategory-keyed
compliance rule doesn't now misfire for existing tenants.

Promote before depending on risk-category-sensitive compliance behavior, or when next adding
compliance suitability test coverage — add a decision-cycle assertion per category and audit
the compliance rules that branch on `riskCategory`.
