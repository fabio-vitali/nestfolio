# investor-ctrl

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-ctrl/src/service.stack.ts

## Constructs

- State (DynamoDB, streams enabled)
- Ingress (TriggerIngress): SQS -> Lambda (event-listener)
- Egress: DynamoDB Streams -> Lambda (event-publisher, CDC)
- Observability: addObservability({ ingress, egress })

## Ingress Subscriptions (14)

From investor-bff: ONBOARDING_COMPLETED, MANDATE_ACCEPTED, MANDATE_REVOKED, INVESTOR_PROFILE_UPDATED, DEPOSIT_INITIATED
From investor-adpt: DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED

Post-collapse migration: legacy MANDATE_CREATED, GOAL_UPDATED, OPERATING_MODE_CHANGED triggers replaced by MANDATE_ACCEPTED, MANDATE_REVOKED, INVESTOR_PROFILE_UPDATED. INVESTOR_PROFILE_UPDATED is processed by a bespoke diff-detect handler that derives goal-change / operating-mode-change notifications from the payload diff.

## Egress (CDC)

| Entity        | insert                 | modify                 |
|---------------|------------------------|------------------------|
| Notification  | NOTIFICATION_CREATED   | NOTIFICATION_UPDATED   |
| MonthlyReport | MONTHLY_REPORT_CREATED | MONTHLY_REPORT_UPDATED |

## Handlers

- event-listener.ts (materializeToTable, errorEventType: INVESTOR_CTRL_FAILED)
  - Tenant events templated via NOTIFICATION_TEMPLATES (ONBOARDING_COMPLETED, MANDATE_ACCEPTED, MANDATE_REVOKED, GOAL_UPDATED, DEPOSIT_INITIATED, OPERATING_MODE_CHANGED, DECISION_APPROVED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED) -> record('Notification')
  - ORDER_FILLED -> [record('Notification'), record('MonthlyReport')]
  - INVESTOR_PROFILE_UPDATED -> bespoke diff handler: emits up to 1 notification per detected change (goal.*, operatingMode) with id suffixed by the diffed field; no notification if no relevant diff
  - 3 system events (BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED) -> record('Notification', tenantId='SYSTEM')
- event-publisher.ts (changeDataCapture)

## DDB Entities

- Notification: pk=Notification#{tenantId}#{notificationId}, sk=Notification
- MonthlyReport: pk=MonthlyReport#{tenantId}#{reportId}, sk=MonthlyReport

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
- onboarding-notification.integration.test.ts (14 events, CDC verification, circuit breaker SYSTEM tenant, INVESTOR_PROFILE_UPDATED diff)

## Dependencies

- libs: cdk-constructs/core, event-processor, event-types
- cross-domain: investor-bff/events, investor-adpt/domain, advisory-adpt/domain, execution-adpt/domain, ledger-adpt/domain
