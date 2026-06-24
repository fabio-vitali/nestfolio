---
id: log-noise-lambda
status: parking
type: task
notes: "Lambda functions emit excessive DEBUG log lines at INFO level, flooding CloudWatch and inflating log costs."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# log-noise-lambda

Lambda functions are emitting excessive DEBUG-level log lines at INFO log level,
causing CloudWatch log groups to fill rapidly and inflating the monthly log ingestion cost.
Root cause: logger misconfiguration — log level not set per environment.
