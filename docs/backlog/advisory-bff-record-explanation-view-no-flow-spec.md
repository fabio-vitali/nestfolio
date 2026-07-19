---
id: advisory-bff-record-explanation-view-no-flow-spec
status: parking
type: doc
notes: "advisory-bff recordExplanationView is a telemetry-only write with no CDC emission and is unmentioned in any flow spec."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-bff recordExplanationView has no flow spec coverage

`advisory-bff`'s `recordExplanationView` mutation is a telemetry-only write with no CDC emission,
and is unmentioned anywhere in `flows/*.flow.yaml`. Filed separately from
[[investor-bff-missing-flow-specs-mutations]] since it's advisory-domain, not investor-domain, and
has no downstream event (a doc-only gap, not an untraced producer).
