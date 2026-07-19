---
id: investor-bff-dead-gdpr-event-types
status: parking
type: bug
notes: "USER_SESSION_EXPIRED / USER_DELETION_REQUESTED / PII_REMOVED / TENANT_ANONYMIZED declared in investor-bff events.ts with no producer and no consumer anywhere."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# investor-bff dead GDPR/session-lifecycle event types

`USER_SESSION_EXPIRED`, `USER_DELETION_REQUESTED`, `PII_REMOVED`, `TENANT_ANONYMIZED`
(`services/investor/investor-bff/src/domain/events.ts:6-9`) have no producer and no consumer
anywhere — planned GDPR/session-lifecycle feature never built. Same [[event-name-integrity]] case (a)
as [[broker-sim-adpt-dead-execution-adpt-event-types]].
