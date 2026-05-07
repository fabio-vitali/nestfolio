---
id: sf-start-idempotency-at-least-once-redelivery
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "LOW priority post-collapse — defer until EB redelivery is observed empirically."
---

# SF-start idempotency for AWS at-least-once redelivery (LOW priority post-collapse)

InvestorProfile collapse workstream (Phase 1, 2026-05-03) eliminated the multi-event-per-action fan-out that motivated the original "duplicate WORKFLOW_TRIGGER_CREATED → duplicate executions" concern. Each user/system action now produces exactly one trigger event → one SF execution. The remaining theoretical risk is AWS EventBridge at-least-once redelivery of a single event id (rare; never observed in this system). The native EB→SF target lacks any per-event `Name` knob (verified 2026-05-03 against `aws-cdk-lib/aws-events/lib/events.generated.d.ts:1533-1660`: `CfnRule.TargetProperty` has no `Name` / `StepFunctionsParameters` field), so adding name-based dedup would require either an EB Pipes + enrichment Lambda or restoring a trigger-handler relay — both reintroduce the Lambda hop the architecture is trying to remove. Defer until either (a) EB redelivery is observed empirically as a real bug, or (b) AWS exposes `Name` on the native target. Lower priority than the day-to-day work — keep filed only as awareness.
