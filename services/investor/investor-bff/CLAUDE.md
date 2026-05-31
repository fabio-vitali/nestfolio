# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled). InvestorProfile is a **single composite row** (sk='InvestorProfile') holding goal, riskProfile, operatingMode, accountMode, executionMode, onboardingCompletedAt, and a monotonic `__version` (seed=1, bumped via `SET #v = if_not_exists(#v,:zero)+:one` on every live InvestorProfile write — the two AppSync resolvers `update-goal`/`update-operating-mode` and `setExecutionMode`; carried in INVESTOR_PROFILE_* CDC for dashboard-bff's InvestorSnapshot P1 projection). Mandate is a **separate sibling aggregate row** (sk='Mandate') with level, status='ISSUED' | 'REVOKED', effectiveDate — updated only by revokeMandate(); not versioned (not projected as P1 anywhere).

## Read model (ownership)
- `ReadModelOwnership` registered in `src/read-model-ownership.ts` (workstream 4):
  - P1 (versioned snapshot via `projectVersioned`): `CashBalance` — ledger-authoritative, versioned on `BALANCE_UPDATED`'s `snapshot.lastEventSequence` (`balance-updated.ts`). `project()`/`accumulate()`/`update()`/`record()` on it now fail typecheck.
  - CommandOwned (local commands after a one-event seed): `InvestorProfile`, `Mandate`, `Notification`. `projectVersioned()` on them fails typecheck.
- NOT registered (intentional): `Deposit`/`Withdrawal` → workstream 5 (externally-settled → P1); `ExecutionModeChange` → write-once audit row, never via an intent.
- Enforcement: `tsconfig.type-test.json` + nx `typecheck` target compile `test/types/read-model-ownership.type-test.ts` (the `@ts-expect-error` trip-wire). Run `pnpm nx run investor-bff:typecheck`. Note: a full-project `tsc` gate is blocked by `investor-bff-13-latent-tsc-errors`, so the narrow type-test config is used.

## Ingress
- InvestorBus → investor-bff-Ingress (SQS → Lambda, event-listener.ts)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED
- InvestorBus → investor-bff-BroadcastIngress (SQS → Lambda, broadcast-listener.ts)
  Subscriptions: BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, DEPOSIT_DETECTED

## Egress (CDC, 6 entity types — 3-tier topology on InvestorProfile)
- DynamoDB Streams → investor-bff-egress (Lambda)
- Declarative `eventTypes` map:
  - InvestorProfile (composite row) → INVESTOR_PROFILE_CREATED (insert); on modify: INVESTOR_PROFILE_UPDATED (carrier, always) + OPERATING_MODE_CHANGED (semantic, onFieldChange:operatingMode) + GOAL_UPDATED (semantic, onFieldChange:goal)
  - Mandate (sibling row, sk='Mandate') → MANDATE_ISSUED (insert, lifecycle), MANDATE_REVOKED (modify, lifecycle)
  - Deposit → DEPOSIT_INITIATED (insert), DEPOSIT_UPDATED (modify)
  - Withdrawal → WITHDRAWAL_REQUESTED (insert), WITHDRAWAL_UPDATED (modify)
  - ExecutionModeChange → EXECUTION_MODE_CHANGED (insert), EXECUTION_MODE_CHANGE_UPDATED (modify)
  - Notification → NOTIFICATION_READ (modify only)

Note: legacy per-entity rows (Goal, RiskProfile, OperatingModeRecord, AccountMode, MandateStatus) and their CDC events (GOAL_*, RISK_PROFILE_*, MANDATE_CREATED/UPDATED, OPERATING_MODE_CHANGE_REQUESTED) are removed. The 3-tier topology (carrier + semantic + lifecycle) replaces the carrier-only pattern from the collapse phase.

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - enableIamAuth: true (allows Lambda→AppSync IAM-signed mutations for feature flags)
  - Query: getProfile (2-step pipeline: get-profile.fn.js + get-profile-mandate.fn.js), getNotifications, getUnreadCount, getFeatureFlags
  - Mutation: updateGoal(input), updateOperatingMode, revokeMandate (returns Mandate), initiateDeposit, requestWithdrawal, requestAccountClosure (noneDataSource), updateFeatureFlag (@aws_iam), markNotificationRead
  - Subscription: onNotification (@aws_subscribe on markNotificationRead), onFeatureFlagUpdate (@aws_subscribe on updateFeatureFlag)
  - Pipeline preSteps: check-feature-flag.fn.js gates initiateDeposit + requestWithdrawal
  - Pipeline extraSteps: get-profile-mandate.fn.js appended to getProfile (fetches Mandate sibling row and merges into response)
- revokeMandate resolver issues a single UpdateItem on the Mandate row (sk='Mandate', status='REVOKED', revokedAt) — CDC then emits MANDATE_REVOKED. No write to InvestorProfile row.
- updateOperatingMode resolver writes operatingMode onto the composite InvestorProfile row — CDC emits INVESTOR_PROFILE_UPDATED (carrier) + OPERATING_MODE_CHANGED (semantic).

## Handlers
- event-listener.ts — materializes USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED (transactWrite: composite InvestorProfile + Mandate sibling row + conditional Deposit), GO_LIVE_CONFIRMED (sets executionMode='live' on the composite row)
- broadcast-listener.ts — BROKER_CIRCUIT_OPEN disables 3 feature flags (confirmDecision, initiateDeposit, requestWithdrawal) via IAM-signed AppSync mutation; BROKER_CIRCUIT_CLOSED re-enables them; DEPOSIT_DETECTED published to investor-facing notification flow
- event-publisher.ts — CDC (changeDataCapture) using the declarative eventTypes map

## Feature Flags (Circuit Breaker)
- BroadcastIngress handler env: APPSYNC_URL (from facade.graphqlUrl)
- BroadcastIngress IAM: appsync:GraphQL grant on Facade API
- AppSync mutations signed via @smithy/signature-v4 + @aws-crypto/sha256-js

## Event Types (domain/events.ts)
InvestorBffEventTypes: USER_REGISTERED, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, OPERATING_MODE_CHANGED, GOAL_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED, DEPOSIT_INITIATED, DEPOSIT_UPDATED, WITHDRAWAL_REQUESTED, WITHDRAWAL_UPDATED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ, EXECUTION_MODE_CHANGED, EXECUTION_MODE_CHANGE_UPDATED, GO_LIVE_CONFIRMED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED

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
- Unit: handlers/event-listener.test.ts, repositories/investor-profile.repository.test.ts, transforms/balance-updated.test.ts, transforms/user-registered.test.ts, transforms/notification-created.test.ts, transforms/onboarding-completed.test.ts, graphql/* (resolver fn unit tests)
- Integration: investor-bff.integration.test.ts (composite-row materialization, AppSync mutations including revokeMandate, AppSync queries, circuit breaker feature flags)

## Dependencies
- libs: cdk-constructs/core, event-processor
- cross-domain imports: investor-ctrl/events, investor-adpt/domain
- runtime deps: @smithy/signature-v4, @aws-crypto/sha256-js (for IAM-signed AppSync calls)
