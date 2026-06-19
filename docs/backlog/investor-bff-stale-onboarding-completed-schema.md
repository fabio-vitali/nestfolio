---
id: investor-bff-stale-onboarding-completed-schema
status: parking
type: refactor
notes: "Surfaced 2026-06-17 by the typed-test-fixtures Phase 1 Task 2 code review. investor-bff/src/domain/schemas.ts still defines an internal OnboardingCompletedSchema (a BusEventSchema-derived shape) whose `subject` block carries tenantId/userId — a pre-DRY-subject holdover. The LIVE consumer path uses the producer-owned OnboardingCompletedRecordSchema (from @nestfolio/onboarding-bff/contracts), which is DRY (no identity), so there is NO behavioral regression and nothing reads the stale schema's identity-bearing subject. But the orphan schema is stale/misleading and contradicts the DRY-subject model. Fix: delete the stale OnboardingCompletedSchema (confirm zero importers first) or align it to the DRY shape. Pre-existing; not introduced by Phase 1. Promote during an investor-bff schema cleanup or when removing pre-DRY schema holdovers."
references:
  - services/investor/investor-bff/src/domain/schemas.ts
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: dry-subject-identity-cleanup
epic_role: core
---

# Stale identity-in-subject OnboardingCompletedSchema in investor-bff

`investor-bff/src/domain/schemas.ts` retains a pre-DRY `OnboardingCompletedSchema` whose
`subject` includes `tenantId`/`userId`. The live path uses the DRY
`OnboardingCompletedRecordSchema` (onboarding-bff/contracts), so this orphan is harmless at
runtime but stale and contradicts the producer-owned DRY-subject convention. Delete it (after
confirming no importers) or align it. Surfaced by the typed-test-fixtures Phase 1 review.
