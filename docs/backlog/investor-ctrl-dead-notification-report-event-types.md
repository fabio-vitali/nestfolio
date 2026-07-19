---
id: investor-ctrl-dead-notification-report-event-types
status: parking
type: bug
notes: "NOTIFICATION_SENT / NOTIFICATION_DELIVERED / MONTHLY_REPORT_GENERATED exported by investor-ctrl but no CDC egress mapping or handler produces them."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# investor-ctrl dead notification/report event types

`NOTIFICATION_SENT`, `NOTIFICATION_DELIVERED`, `MONTHLY_REPORT_GENERATED`
(`services/investor/investor-ctrl/src/domain/events.ts:6-8`) are exported but no CDC egress mapping or
handler produces them. Same [[event-name-integrity]] case (a) as [[investor-bff-dead-gdpr-event-types]].
