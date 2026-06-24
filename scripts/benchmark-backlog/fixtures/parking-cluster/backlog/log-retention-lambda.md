---
id: log-retention-lambda
status: parking
type: task
notes: "Lambda execution log groups are created with no retention policy, so logs are kept forever and storage cost climbs."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# log-retention-lambda

The Lambda execution log groups are created without a `retention` property and never expire.
**Root cause:** the shared CDK log-group construct does not set a retention policy — the exact
same defect as `log-retention-missing`, just on the Lambda log groups instead of the API ones.
