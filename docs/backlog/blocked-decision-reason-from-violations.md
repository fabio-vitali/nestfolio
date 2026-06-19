---
id: blocked-decision-reason-from-violations
status: parking
type: epic
notes: "ComplianceCheck/DECISION_BLOCKED carries violations[] but no human-readable reason, so every consumer that wants a block reason degrades. Theme epic, 2 members."
done_when: "A human-readable block reason is derived from violations[] (at the producer or a shared helper) and each consumer surfaces it instead of degrading; both members shipped or dropped."
scope: "Consumers of the blocked-decision compliance payload that need a human-readable reason which the ComplianceCheck only expresses as violations[{rule,description,severity}]."
out_of_scope:
  - "The typed-subject parse-subject conversion of the same payload — already done; these are the residual behavioral gap"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Blocked-decision reason from violations

Root cause: the real ComplianceCheck carries `violations: [{rule, description, severity}]` and no `reason`/`blockReason` string, so every consumer that wants a human-readable block reason degrades (DecisionPacket.blockReason stays undefined; dashboard-bff description degrades to decisionId). Fix pattern: derive a block reason from violations (e.g. the first BLOCKING violation's description, or a joined summary) and have consumers surface it; assert it is populated on a real blocked decision.

Members (derived from `epic:` pointers):
- `dwc-sfn-callback-reason-blockreason-gap`
- `dashboard-bff-decision-blocked-reason-field-mismatch`
