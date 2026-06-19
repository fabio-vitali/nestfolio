---
id: broker-sim-inbound-schemas-nondry-stale
status: parking
type: bug
notes: "broker-sim-adpt schemas.ts inbound schemas (SimOrderRequestedSchema/SimDepositInitiatedSchema/SimWithdrawalRequestedSchema) carry tenantId/userId in the subject (non-DRY); SimWithdrawalRequestedSchema also has a stale `amount` field the handler no longer reads (it parseSubjects WithdrawalInitiatedSchema and reads amountCents). Consumer-side schemas superseded by Phase-3 producer-owned DRY schemas in broker-ctrl."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: dry-subject-identity-cleanup
epic_role: core
---

# broker-sim-adpt — inbound schemas non-DRY + stale `amount` field

## Evidence

`services/execution/broker-sim-adpt/src/domain/schemas.ts` defines inbound `BusEventSchema.extend(...)` schemas that model the shapes broker-sim-adpt *expects to receive*. These consumer-side schemas put identity fields (`tenantId`, `userId`) directly on the subject — a DRY-subject violation.

Affected schemas:
- `SimOrderRequestedSchema` — subject includes `tenantId`, `userId`
- `SimDepositInitiatedSchema` — subject includes `tenantId`, `userId`
- `SimWithdrawalRequestedSchema` — subject includes `tenantId`, `userId`

## Additional stale field: `amount` in SimWithdrawalRequestedSchema

`SimWithdrawalRequestedSchema` declares `amount` (dollars, a `number`) in its subject. However the live handler in `services/execution/broker-sim-adpt/src/handlers/event-listener.ts:75` does:

```ts
parseSubject(payload, WithdrawalInitiatedSchema)
```

…and then reads `subject.amountCents / 100` (~line 80). The `WithdrawalInitiatedSchema` carries `amountCents` (cents integer), not `amount` (dollar float). The `amount` field in `SimWithdrawalRequestedSchema` is therefore dead — it is declared but never read by the handler.

## Relationship to Phase 3

Phase 3 introduced producer-owned DRY schemas in `broker-ctrl/src/domain/contracts.ts` (`BrokerOrderRequestSchema`, etc.) and the typed fixtures use those. The consumer-side `schemas.ts` in broker-sim-adpt is a legacy artifact that predates producer-owned contracts and was not cleaned up in Phase 3 (out of scope).

## Fix

1. Delete or replace `SimOrderRequestedSchema`, `SimDepositInitiatedSchema`, `SimWithdrawalRequestedSchema` in `schemas.ts` with imports of the producer-owned DRY schemas from `broker-ctrl/src/domain/contracts.ts`.
2. Remove the dead `amount` field from `SimWithdrawalRequestedSchema` (or the whole schema if replaced).
3. Update handler call-sites in `event-listener.ts` to use `parseSubject(payload, <ProducerSchema>)`.

## Promote when

A broker-sim schema cleanup pass is scheduled (can combine with `[[route-order-userid-in-subject-nondry]]` in a single execution-domain DRY hardening pass).
