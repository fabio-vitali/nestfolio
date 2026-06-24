---
id: decoy-ddb-ttl
status: parking
type: task
notes: "DynamoDB tables do not have TTL enabled for transient event records, causing unbounded table growth."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# decoy-ddb-ttl

DynamoDB tables storing transient event records do not have TTL configured.
This is unrelated to the logging cost cluster and represents a standalone data
lifecycle concern at the DynamoDB layer rather than the observability/logging layer.
