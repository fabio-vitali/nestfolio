# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → investor-bff-ingress (SQS → Lambda)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED, OPERATING_MODE_CHANGED

## Egress
- CDC: DynamoDB Streams → investor-bff-egress (Lambda)
  Emits:
  - Goal → GOAL
  - RiskProfile → RISK_PROFILE
  - Mandate → MANDATE
  - OperatingModeRecord → insert: OPERATING_MODE_SELECTED, modify: OPERATING_MODE_CHANGED
  - InvestorProfile → INVESTOR_PROFILE
  - Deposit → insert: DEPOSIT_INITIATED, modify: DEPOSIT_UPDATED
  - Withdrawal → insert: WITHDRAWAL_REQUESTED, modify: WITHDRAWAL_UPDATED
  - ExecutionModeChange → insert: EXECUTION_MODE_CHANGED, modify: EXECUTION_MODE_CHANGE_UPDATED

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - get-profile, get-goals, update-goal, get-notifications, get-unread-count, mark-notification-read
  - update-mandate, revoke-mandate, initiate-deposit, request-withdrawal, request-account-closure (noneDataSource)

## Handlers
- event-listener.ts — materializes USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, OPERATING_MODE_CHANGED (updates Mandate guardrail params); GO_LIVE_CONFIRMED sets execution mode via profileRepo
- event-publisher.ts — CDC (changeDataCapture)

## Event Types (domain/events.ts)
- InvestorBffEventTypes: USER_REGISTERED, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ

## Tests
- handlers/event-listener.test.ts
- repositories/investor-profile.repository.test.ts
- transforms/balance-updated.test.ts
- transforms/user-registered.test.ts
- transforms/notification-created.test.ts
- transforms/onboarding-completed.test.ts
- transforms/operating-mode-changed.test.ts

## Dependencies
- libs: cdk-constructs/core, event-processor
- cross-domain imports: investor-ctrl/events, ledger-adpt/domain
