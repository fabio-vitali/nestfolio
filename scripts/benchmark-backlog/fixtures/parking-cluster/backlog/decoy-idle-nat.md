---
id: decoy-idle-nat
status: parking
type: task
notes: "An idle NAT Gateway runs 24/7 in a deprecated subnet with no traffic, accruing flat hourly charges."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# decoy-idle-nat

A NAT Gateway provisioned for a now-deprecated subnet still runs 24/7 with effectively no
traffic, accruing a flat hourly charge. **Root cause:** orphaned / over-provisioned infrastructure
left behind by a teardown that missed it — a one-shot decommission, NOT a missing lifecycle or
retention policy and NOT unbounded growth. It shares only the "AWS cost" *symptom* with the log
retention cluster; its root cause is unrelated, so it must stay an un-clustered singleton.
