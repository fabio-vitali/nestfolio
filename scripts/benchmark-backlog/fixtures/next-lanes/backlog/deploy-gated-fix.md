---
id: deploy-gated-fix
status: queued
rank: 40
type: task
notes: "A CDC-wiring fix whose only validation is a dev deploy + the e2e feature suite against deployed dev — Complex lane."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# deploy-gated-fix: Cross-domain CDC wiring fix needing deploy + e2e

This fix changes a cross-domain adapter's CDC subscription and an Egress `eventTypes` mapping.
It cannot be validated by unit tests alone: the only way to prove the event actually flows
end-to-end is to **deploy to dev** and run the **e2e feature suite** against deployed dev. Because
its done-definition requires a real deploy and e2e gate, the expected lane is **Complex** —
isolation worktree + branch + PR, with the deploy and e2e run in the closing phase.
