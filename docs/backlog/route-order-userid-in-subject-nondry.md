---
id: route-order-userid-in-subject-nondry
status: parking
type: bug
notes: "broker-ctrl route-order.ts emits SIM_ORDER_REQUESTED / ALPACA_ORDER_REQUESTED with userId IN the subject (non-DRY); identity belongs in context. Phase-3 BrokerOrderRequestSchema is DRY and adapter consumers read identity from context, so no runtime break — but the producer emission carries a redundant identity field."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: dry-subject-identity-cleanup
epic_role: core
---

# broker-ctrl route-order.ts — userId duplicated onto subject (non-DRY)

## Evidence

`services/execution/broker-ctrl/src/handlers/route-order.ts` (~lines 52–59) builds the emitted event subject as:

```ts
{ orderId, userId, symbol, side, quantity }
```

AND passes context:

```ts
context: { tenantId, userId, region }
```

The `userId` field is present in BOTH the subject and the context — a DRY-subject violation. Identity (tenantId, userId) is supposed to travel exclusively in the event context (`RequestContext`) so that subjects remain purely domain-data.

## Same class as

`[[dwc-sf-command-subject-tenantid-nondry]]` — the `decision-workflow-ctrl` had the same pattern (tenantId on subject) and was filed as a peer finding.

## No runtime break

Phase 3 introduced `BrokerOrderRequestSchema` as the producer-owned DRY contract for these events. Adapter consumers (`broker-sim-adpt`, `broker-alpaca-adpt`) read identity from `context`, not `subject`, so the redundant `userId` on the subject is silently ignored. There is no observed runtime breakage.

## Fix

In `route-order.ts`, drop `userId` from the emitted subject object. The full identity remains available to consumers via `context.userId`.

## Promote when

Hardening producer DRY-subject compliance across the execution domain (e.g. as part of an event-subject-contracts cleanup pass).
