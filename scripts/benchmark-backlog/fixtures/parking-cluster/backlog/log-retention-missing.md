---
id: log-retention-missing
status: parking
type: task
notes: "API-service CloudWatch log groups are created with no retention policy, so logs are kept forever and storage cost climbs."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# log-retention-missing

The API services' CloudWatch log groups are created without a `retention` property.
**Root cause:** the shared CDK log-group construct does not set a retention policy, so
log groups default to never-expire. This is the same root cause as `log-retention-lambda`.
