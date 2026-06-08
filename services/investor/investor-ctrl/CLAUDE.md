# investor-ctrl

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-ctrl/src/service.stack.ts

## Constructs

- State (DynamoDB, streams enabled)
- Ingress (TriggerIngress): SQS -> Lambda (event-listener)
- Egress: DynamoDB Streams -> Lambda (event-publisher, CDC)
- Observability: addObservability({ ingress, egress })

## Ingress Subscriptions (15)

From investor-bff: ONBOARDING_COMPLETED, MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED, GOAL_UPDATED, DEPOSIT_INITIATED
From investor-adpt: DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_SETTLED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED

Post-resplit (2026-05-08): INVESTOR_PROFILE_UPDATED diff-detect handler removed. Now subscribes directly to semantic events (OPERATING_MODE_CHANGED, GOAL_UPDATED) and lifecycle events (MANDATE_ISSUED, MANDATE_REVOKED). Each event maps to its own NOTIFICATION_TEMPLATE entry — no payload inspection required.

## Egress (CDC)

| Entity        | insert                 | modify                 |
|---------------|------------------------|------------------------|
| Notification  | NOTIFICATION_CREATED   | NOTIFICATION_UPDATED   |
| MonthlyReport | MONTHLY_REPORT_CREATED | MONTHLY_REPORT_UPDATED |

## Handlers

- event-listener.ts (materializeToTable, errorEventType: INVESTOR_CTRL_FAILED)
  - Tenant events templated via NOTIFICATION_TEMPLATES (ONBOARDING_COMPLETED, MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED, GOAL_UPDATED, DEPOSIT_INITIATED, DECISION_APPROVED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_SETTLED) -> record('Notification')
  - ORDER_FILLED -> [record('Notification'), record('MonthlyReport')]
  - 3 system events (BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED) -> record('Notification', tenantId='SYSTEM')
  - relatedEntityType/relatedEntityId derived from each triggering event's subject via NOTIFICATION_ENTITY_MAP (DECISION→decisionId, ORDER→orderId, DEPOSIT→depositId, WITHDRAWAL→transferId, MANDATE→mandateId, PROFILE→userId; BALANCE/SYSTEM have no id, fall back to ctx.eventId). Powers the investor-mfe deep-link.
  - No INVESTOR_PROFILE_UPDATED diff handler (removed in resplit 2026-05-08)
- event-publisher.ts (changeDataCapture)

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (seeded by one idempotent event via record()): Notification, MonthlyReport
- Enforced by `nx run investor-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## DDB Entities

- Notification: pk=Notification#{tenantId}#{notificationId}, sk=Notification
- MonthlyReport: pk=MonthlyReport#{tenantId}#{reportId}, sk=MonthlyReport

## Exported surface

- @nestfolio/investor-ctrl/events (src/domain/events.ts) — InvestorCtrlEventTypes
- @nestfolio/investor-ctrl/contracts (src/domain/contracts.ts) — producer-owned zod payload contracts (imports ONLY zod). NotificationCreatedSchema models the NOTIFICATION_CREATED subject; consumed by investor-bff/transforms/notification-created.ts via parseSubject. Payload changes here break consumer builds (event-subject-payload-build-tripwire).

## Event Types (domain/events.ts)

InvestorCtrlEventTypes: NOTIFICATION_CREATED, NOTIFICATION_UPDATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_CREATED, MONTHLY_REPORT_UPDATED, MONTHLY_REPORT_GENERATED

## Services

- notification-delivery.service.ts (push + email delivery)
- notification-lifecycle.service.ts

## Tests

Unit (test/unit/):
- event-listener.test.ts (templated + diff-detect paths)
- notification-delivery.service.test.ts
- notification-lifecycle.service.test.ts
- notification.repository.test.ts

Integration (test/integration/):
- onboarding-notification.integration.test.ts (15 events, CDC verification, circuit breaker SYSTEM tenant, OPERATING_MODE_CHANGED + GOAL_UPDATED direct subscriptions)

## Dependencies

- libs: cdk-constructs/core, event-processor, event-types
- cross-domain: investor-bff/events, investor-adpt/domain, advisory-adpt/domain, execution-adpt/domain, ledger-adpt/domain
