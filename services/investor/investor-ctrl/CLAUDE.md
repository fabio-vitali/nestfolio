# investor-ctrl

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → investor-ctrl-trigger-ingress (SQS → Lambda)
  Subscriptions: ONBOARDING_COMPLETED, MANDATE_GRANTED, GOAL_UPDATED, DEPOSIT_INITIATED, OPERATING_MODE_CHANGED, DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED

## Egress
- CDC: DynamoDB Streams → investor-ctrl-egress (Lambda)
  Emits: Notification, MonthlyReport

## Handlers
- event-listener.ts
- event-publisher.ts

## Event Types (domain/events.ts)
- InvestorCtrlEventTypes: NOTIFICATION_CREATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_GENERATED

## Tests
- event-listener.test.ts
- notification.service.test.ts
- notification.repository.test.ts

## Dependencies
- libs: cdk-constructs/core
