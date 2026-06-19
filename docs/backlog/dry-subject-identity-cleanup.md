---
id: dry-subject-identity-cleanup
status: parking
type: epic
notes: "Producer emissions/schemas carry identity (tenantId/userId) in the event subject, violating the DRY-subject model; identity belongs in context. Theme epic, 4 members."
done_when: "Each in-scope producer emission/schema drops identity from the subject (consumers already read identity from RequestContext, so no runtime break); all members shipped or dropped."
scope: "Producer-side event subjects (or consumer-side holdover schemas) that carry tenantId/userId though identity belongs in the RequestContext per the DRY-subject model."
out_of_scope:
  - "Consumer reads of fields the producer contract never codified (typed-subject-consumer-contract-gaps) — a real contract gap, not redundant identity"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# DRY-subject identity cleanup

Root cause: the DRY-subject model puts identity (tenantId/userId) in the RequestContext, not the event subject — but several producers still emit, and some consumers still declare, subject schemas that carry identity. No runtime break (consumers read identity from context), but the emissions/schemas are non-DRY holdovers that contradict the model. Fix pattern: remove identity from the subject schema/emission; verify consumers read from context.

Members (derived from `epic:` pointers):
- `broker-sim-inbound-schemas-nondry-stale`
- `dwc-sf-command-subject-tenantid-nondry`
- `route-order-userid-in-subject-nondry`
- `investor-bff-stale-onboarding-completed-schema`
