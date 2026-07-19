---
id: investor-bff-missing-flow-specs-mutations
status: parking
type: doc
notes: "5 investor-bff mutations (updateGoal, markNotificationRead, updateRiskProfile, revokeMandate, updateOperatingMode) produce/consume events with no corresponding flow spec step."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-bff mutations missing flow spec coverage

Five investor-bff mutations have events with no flow-spec documentation of the hop: `updateGoal`
-> `GOAL_UPDATED` (no flow spec at all); `markNotificationRead` -> `NOTIFICATION_READ` (no flow
spec); `updateRiskProfile` -> falls through to `INVESTOR_PROFILE_UPDATED`, untraced as a producer
in `flows/advisory-cycle.flow.yaml`; `revokeMandate` -> `MANDATE_REVOKED`, consumed cross-domain
but no explicit step traces the mutation; `updateOperatingMode` -> `OPERATING_MODE_CHANGED`,
consumed but producer-side untraced in `flows/advisory-cycle.flow.yaml`. Grouped as one doc-layer
item, same shape as the already-shipped [[investor-domain-missing-flow-specs-adapter-hops]]
precedent (a prior batch of missing investor-domain flow-spec hops).
