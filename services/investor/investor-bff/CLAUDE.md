# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled). InvestorProfile is a **single composite row** (sk='InvestorProfile') holding goal, riskProfile, operatingMode, mandate, accountMode, executionMode, onboardingCompletedAt. MandateStatus is a sibling lifecycle row (sk='MandateStatus') with status='ACCEPTED' | 'REVOKED'.

## Ingress
- InvestorBus → investor-bff-Ingress (SQS → Lambda, event-listener.ts)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED
- InvestorBus → investor-bff-BroadcastIngress (SQS → Lambda, broadcast-listener.ts)
  Subscriptions: BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, DEPOSIT_DETECTED

## Egress (CDC, 6 entity types — collapsed from 9)
- DynamoDB Streams → investor-bff-egress (Lambda)
- Declarative `eventTypes` map:
  - InvestorProfile (composite row) → INVESTOR_PROFILE_CREATED (insert), INVESTOR_PROFILE_UPDATED (modify)
  - MandateStatus → MANDATE_ACCEPTED (insert), MANDATE_REVOKED (modify)
  - Deposit → DEPOSIT_INITIATED (insert), DEPOSIT_UPDATED (modify)
  - Withdrawal → WITHDRAWAL_REQUESTED (insert), WITHDRAWAL_UPDATED (modify)
  - ExecutionModeChange → EXECUTION_MODE_CHANGED (insert), EXECUTION_MODE_CHANGE_UPDATED (modify)
  - Notification → NOTIFICATION_READ (modify only)

Note: legacy per-entity rows (Goal, RiskProfile, Mandate, OperatingModeRecord, AccountMode) and their CDC events (GOAL_*, RISK_PROFILE_*, MANDATE_CREATED/UPDATED, OPERATING_MODE_*) are removed — the composite row now carries those fields and a single INVESTOR_PROFILE_UPDATED event covers all profile mutations.

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - enableIamAuth: true (allows Lambda→AppSync IAM-signed mutations for feature flags)
  - Query: getProfile, getNotifications, getUnreadCount, getFeatureFlags
  - Mutation: updateGoal(input), updateMandate, revokeMandate (returns MandateStatus), initiateDeposit, requestWithdrawal, requestAccountClosure (noneDataSource), updateFeatureFlag (@aws_iam), markNotificationRead
  - Subscription: onNotification (@aws_subscribe on markNotificationRead), onFeatureFlagUpdate (@aws_subscribe on updateFeatureFlag)
  - Pipeline preSteps: check-feature-flag.fn.js gates initiateDeposit + requestWithdrawal
- revokeMandate resolver issues a single UpdateItem on the MandateStatus row (status='REVOKED', revokedAt) — CDC then emits MANDATE_REVOKED. No write to InvestorProfile.

## Handlers
- event-listener.ts — materializes USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED (transactWrite: composite InvestorProfile + MandateStatus + conditional Deposit), GO_LIVE_CONFIRMED (sets executionMode='live' on the composite row)
- broadcast-listener.ts — BROKER_CIRCUIT_OPEN disables 3 feature flags (confirmDecision, initiateDeposit, requestWithdrawal) via IAM-signed AppSync mutation; BROKER_CIRCUIT_CLOSED re-enables them; DEPOSIT_DETECTED published to investor-facing notification flow
- event-publisher.ts — CDC (changeDataCapture) using the declarative eventTypes map

## Feature Flags (Circuit Breaker)
- BroadcastIngress handler env: APPSYNC_URL (from facade.graphqlUrl)
- BroadcastIngress IAM: appsync:GraphQL grant on Facade API
- AppSync mutations signed via @smithy/signature-v4 + @aws-crypto/sha256-js

## Event Types (domain/events.ts)
InvestorBffEventTypes: USER_REGISTERED, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ACCEPTED, MANDATE_REVOKED, DEPOSIT_INITIATED, DEPOSIT_UPDATED, WITHDRAWAL_REQUESTED, WITHDRAWAL_UPDATED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ, EXECUTION_MODE_CHANGED, EXECUTION_MODE_CHANGE_UPDATED, GO_LIVE_CONFIRMED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED

## MFE Hosting
- MfeBucket (mfeKey=investor): S3 bucket "{account}-{prefix}-nestfolio-mfe-investor"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Tests
- Unit: handlers/event-listener.test.ts, repositories/investor-profile.repository.test.ts, transforms/balance-updated.test.ts, transforms/user-registered.test.ts, transforms/notification-created.test.ts, transforms/onboarding-completed.test.ts, domain/guardrail-params.test.ts, graphql/* (resolver fn unit tests)
- Integration: investor-bff.integration.test.ts (composite-row materialization, AppSync mutations including revokeMandate, AppSync queries, circuit breaker feature flags)

## Dependencies
- libs: cdk-constructs/core, event-processor
- cross-domain imports: investor-ctrl/events, investor-adpt/domain
- runtime deps: @smithy/signature-v4, @aws-crypto/sha256-js (for IAM-signed AppSync calls)
