---
id: investor-bff-e2e-coverage-gaps
status: parking
type: tooling
notes: "Three investor-bff/onboarding-bff mutations have no E2E coverage driving them live: onboarding flow, updateRiskProfile, updateFeatureFlag."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-bff / onboarding-bff E2E coverage gaps

Three coverage gaps in `apps/e2e-feature-tests/`: (1) no test drives the onboarding-bff flow live
via GraphQL — only a `onboarded()` DDB fixture is used, never the real mutation path; (2)
investor-bff's `updateRiskProfile` mutation is untested; (3) investor-bff's `updateFeatureFlag`
mutation is untested. Grouped as one item since all three are investor-domain E2E coverage gaps of
the same shape (mutation exists, no E2E scenario exercises it).
