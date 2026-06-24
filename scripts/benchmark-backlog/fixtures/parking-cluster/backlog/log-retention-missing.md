---
id: log-retention-missing
status: parking
type: task
notes: "CloudWatch log groups have no retention policy set, so logs accumulate indefinitely and drive up storage costs."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# log-retention-missing

CloudWatch log groups across all Lambda functions lack a retention policy. Combined
with the noisy log emission (see log-noise-lambda), logs accumulate indefinitely.
Root cause: observability config not enforcing log retention at CDK construct level.
