# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → investor-bff-ingress (SQS → Lambda)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED, OPERATING_MODE_CHANGED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED

## Egress
- CDC: DynamoDB Streams → investor-bff-egress (Lambda)
  Emits:
  - Goal → GOAL_CREATED (insert), GOAL_UPDATED (modify)
  - RiskProfile → RISK_PROFILE_CREATED (insert), RISK_PROFILE_UPDATED (modify)
  - Mandate → MANDATE_CREATED (insert), MANDATE_UPDATED (modify)
  - OperatingModeRecord → OPERATING_MODE_SELECTED (insert), OPERATING_MODE_CHANGED (modify)
  - InvestorProfile → INVESTOR_PROFILE_CREATED (insert), INVESTOR_PROFILE_UPDATED (modify)
  - Deposit → DEPOSIT_INITIATED (insert), DEPOSIT_UPDATED (modify)
  - Withdrawal → WITHDRAWAL_REQUESTED (insert), WITHDRAWAL_UPDATED (modify)
  - ExecutionModeChange → EXECUTION_MODE_CHANGED (insert), EXECUTION_MODE_CHANGE_UPDATED (modify)
  - Notification → NOTIFICATION_READ (modify)

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - enableIamAuth: true (allows Lambda→AppSync IAM-signed mutations for feature flags)
  - Query: get-profile, get-goals, get-notifications, get-unread-count, get-feature-flags
  - Mutation: update-goal, update-mandate, revoke-mandate, initiate-deposit, request-withdrawal, request-account-closure (noneDataSource), update-feature-flag (@aws_iam), mark-notification-read
  - Subscription: on-feature-flag-update (@aws_subscribe on updateFeatureFlag)
  - Pipeline steps: check-feature-flag.fn.js gates initiateDeposit + requestWithdrawal

## Handlers
- event-listener.ts — materializes USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, OPERATING_MODE_CHANGED; GO_LIVE_CONFIRMED sets execution mode; BROKER_CIRCUIT_OPEN disables 3 feature flags (confirmDecision, initiateDeposit, requestWithdrawal) via IAM-signed AppSync mutation; BROKER_CIRCUIT_CLOSED re-enables same flags
- event-publisher.ts — CDC (changeDataCapture)

## Feature Flags (Circuit Breaker)
- BROKER_CIRCUIT_OPEN handler: calls updateFeatureFlag(enabled: false) for confirmDecision, initiateDeposit, requestWithdrawal
- BROKER_CIRCUIT_CLOSED handler: calls updateFeatureFlag(enabled: true) for same flags
- AppSync mutations signed via @smithy/signature-v4 + @aws-crypto/sha256-js
- Ingress handler env: APPSYNC_URL (from facade.graphqlUrl)
- Ingress handler IAM: appsync:GraphQL grant on Facade API

## Event Types (domain/events.ts)
- InvestorBffEventTypes: USER_REGISTERED, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, GO_LIVE_CONFIRMED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, DEPOSIT_UPDATED, WITHDRAWAL_UPDATED, EXECUTION_MODE_CHANGED, EXECUTION_MODE_CHANGE_UPDATED

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
- runtime deps: @smithy/signature-v4, @aws-crypto/sha256-js (for IAM-signed AppSync calls)
