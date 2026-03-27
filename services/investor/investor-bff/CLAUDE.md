# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → investor-bff-ingress (SQS → Lambda)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED

## Egress
- CDC: DynamoDB Streams → investor-bff-egress (Lambda)
  Emits: Goal, RiskProfile, Mandate, OperatingModeRecord, InvestorProfile, Deposit, Withdrawal, ExecutionModeChange

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - requestAccountClosure uses noneDataSource

## Handlers
- event-listener.ts
- event-publisher.ts

## Event Types (domain/events.ts)
- InvestorBffEventTypes: USER_REGISTERED, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ

## Tests
- handlers/event-listener.test.ts
- handlers/event-publisher.test.ts
- repositories/investor-profile.repository.test.ts
- transforms/balance-updated.test.ts
- transforms/user-registered.test.ts
- transforms/notification-created.test.ts
- transforms/onboarding-completed.test.ts

## Dependencies
- libs: cdk-constructs/core
