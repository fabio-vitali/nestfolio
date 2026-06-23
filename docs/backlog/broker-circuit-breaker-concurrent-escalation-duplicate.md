---
id: broker-circuit-breaker-concurrent-escalation-duplicate
status: parking
type: bug
notes: "Idempotent heal dedups the CLOSE path but not ESCALATION: concurrent heals that all exhaust retries each emit BROKER_HEAL_ESCALATED -> duplicate investor-ctrl notifications. Rare + low harm."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: at-least-once-dedup-gaps
epic_role: core
---

# Heal escalation path is not deduped across concurrent heals

Surfaced 2026-06-15 during the idempotent-heal rewrite
([[broker-circuit-breaker-heal-singleton-guard]], plan
`docs/superpowers/plans/2026-06-15-broker-circuit-breaker-idempotent-heal.md`).

## Evidence

The idempotent heal fully dedups the **close** path: `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`
entry `GetItem`+`Choice` no-ops a non-OPEN breaker, and `CloseBreaker` is a conditional `UpdateItem`
(`state=OPEN`) so only the OPEN→CLOSED transition reaches `EmitBreakerClosed` →
`BROKER_CIRCUIT_CLOSED` is emitted exactly once per open episode.

The **escalation** path (`EscalateHealFailure`) is NOT deduped. If `BROKER_CIRCUIT_OPEN` is
redelivered (CDC at-least-once) within the multi-minute heal retry window AND the broker stays down
through the full retry loop (default 10 attempts × 60s), each concurrent `HealStateMachine` execution
reaches `EscalateHealFailure` and emits its own `BROKER_HEAL_ESCALATED`. `investor-ctrl`
(`services/investor/investor-ctrl/src/handlers/event-listener.ts`) creates a notification keyed
`Notification#SYSTEM#${eventId}`, so distinct escalation events → distinct rows → duplicate
"we're looking into an issue" notifications.

Rare (requires redelivery within the retry window AND a total broker outage) and low harm.

## Cheapest fix

Mirror the close-dedup: gate `EscalateHealFailure` behind a conditional `UpdateItem` on the global
`CircuitBreaker#alpaca` row (`ConditionExpression: attribute_not_exists(healEscalatedAt)`,
`SET healEscalatedAt = $$.State.EnteredTime`); on condition-fail, skip the emit and terminate. The
marker resets naturally because `CircuitBreakerRepository.open()` does a full-item `PutItem` on the
next open episode (no `healEscalatedAt`).

## Promote when

Hardening circuit-breaker escalation, or if duplicate escalation notifications are observed in dev/prod.
