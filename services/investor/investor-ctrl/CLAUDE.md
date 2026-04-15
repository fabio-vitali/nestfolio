# investor-ctrl

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → investor-ctrl-trigger-ingress (SQS → Lambda)
  Subscriptions: ONBOARDING_COMPLETED, MANDATE_CREATED, GOAL_UPDATED, DEPOSIT_INITIATED, OPERATING_MODE_CHANGED, DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED

## Egress
- CDC: DynamoDB Streams → investor-ctrl-egress (Lambda)
  Emits:
  - Notification → NOTIFICATION_CREATED (insert), NOTIFICATION_UPDATED (modify)
  - MonthlyReport → MONTHLY_REPORT_CREATED (insert), MONTHLY_REPORT_UPDATED (modify)

## Handlers
- event-listener.ts — creates Notification records for all subscribed events; creates MonthlyReport on ORDER_FILLED; BROKER_CIRCUIT_OPEN/CLOSED/HEAL_ESCALATED create SYSTEM tenant notifications (tenantId='SYSTEM')
- event-publisher.ts — CDC (changeDataCapture)

## Notification Templates (Circuit Breaker)
- BROKER_CIRCUIT_OPEN: "Some features are temporarily paused" (push)
- BROKER_CIRCUIT_CLOSED: "All features are available" (push)
- BROKER_HEAL_ESCALATED: "We're looking into an issue" (email,push)

## Event Types (domain/events.ts)
- InvestorCtrlEventTypes: NOTIFICATION_CREATED, NOTIFICATION_UPDATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_CREATED, MONTHLY_REPORT_UPDATED, MONTHLY_REPORT_GENERATED

## Tests
- event-listener.test.ts
- notification-delivery.service.test.ts
- notification-lifecycle.service.test.ts
- notification.repository.test.ts

## Dependencies
- libs: cdk-constructs/core, event-processor
- cross-domain imports: investor-bff/events, advisory-adpt/domain, execution-adpt/domain, ledger-adpt/domain
