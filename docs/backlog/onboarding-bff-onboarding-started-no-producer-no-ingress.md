---
id: onboarding-bff-onboarding-started-no-producer-no-ingress
status: parking
type: bug
notes: "ONBOARDING_STARTED declared in onboarding-bff events.ts has no emitter, and service.stack.ts has no Ingress construct at all."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# onboarding-bff ONBOARDING_STARTED — no producer, no ingress

`ONBOARDING_STARTED` (`services/investor/onboarding-bff/src/domain/events.ts:3`) has no emitter and
`service.stack.ts` has no `Ingress` construct at all — a fully dead declaration on both the producer
and consumer side. Same [[event-name-integrity]] case (a) as [[investor-ctrl-dead-notification-report-event-types]].
