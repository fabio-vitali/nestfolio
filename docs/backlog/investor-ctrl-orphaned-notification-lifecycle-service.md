---
id: investor-ctrl-orphaned-notification-lifecycle-service
status: parking
type: refactor
notes: "NotificationLifecycleService / NotificationDeliveryService / NotificationRepository in investor-ctrl are unreferenced dead code, already diverged from the live handler."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-ctrl orphaned NotificationLifecycleService

`NotificationLifecycleService`, `NotificationDeliveryService`, `NotificationRepository`
(services/investor/investor-ctrl) are entirely unreferenced by the actual handler, which builds
notification records inline instead; their template maps have already silently diverged from the
live `NOTIFICATION_TEMPLATES` in `event-listener.ts`.
