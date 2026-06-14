# investor-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled). InvestorProfile is a **single composite row** (sk='InvestorProfile') holding goal, riskProfile, operatingMode, accountMode, executionMode, onboardingCompletedAt, and a monotonic `__version` (seed=1, bumped via `SET #v = if_not_exists(#v,:zero)+:one` on every live InvestorProfile write — the two AppSync resolvers `update-goal`/`update-operating-mode` and `setExecutionMode`; carried in INVESTOR_PROFILE_* CDC for dashboard-bff's InvestorSnapshot P1 projection). Mandate is a **separate sibling aggregate row** (sk='Mandate') with level, status='ACTIVE' | 'REVOKED', effectiveDate, and a monotonic `__version` (seed=1 on MANDATE_ISSUED; bumped via `if_not_exists(#v,:zero)+:one` in the revokeMandate resolver, WS-B) — carried on MANDATE_ISSUED/MANDATE_REVOKED for downstream dual P1 projection (compliance-ctrl + DWC) landing in WS-C.

## Read model (ownership)
- `ReadModelOwnership` registered in `src/read-model-ownership.ts` (workstream 4):
  - P1 (versioned snapshot via `projectVersioned`): `CashBalance` — ledger-authoritative, versioned on `BALANCE_UPDATED`'s `snapshot.lastEventSequence` (`balance-updated.ts`). `Deposit`, `WithdrawalRequest` — broker-ctrl owns the funding lifecycle; investor-bff projects them via `projectVersioned` only (project/accumulate/update/record fail typecheck).
  - CommandOwned (local commands after a one-event seed): `InvestorProfile`, `Mandate`, `Notification`, `DepositIntent`, `WithdrawalIntent`. `projectVersioned()` on them fails typecheck.
  - CommandOwned (documentary; command-written, not an intent factory — WS-D): `FeatureFlag` — system flag store written by the `updateFeatureFlag` resolver + the circuit-breaker IAM-signed mutation, read by `getFeatureFlags` + `onFeatureFlagUpdate`.
- NOT registered (intentional): `ExecutionModeChange` → write-once audit row, never via an intent.
- Enforcement: `tsconfig.type-test.json` + nx `typecheck` target compile `test/types/read-model-ownership.type-test.ts` (the `@ts-expect-error` trip-wire). Run `pnpm nx run investor-bff:typecheck`. Note: a full-project `tsc` gate is blocked by `investor-bff-13-latent-tsc-errors`, so the narrow type-test config is used.

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- BroadcastIngress (broadcast-listener.ts): BROKER_CIRCUIT_CLOSED, BROKER_CIRCUIT_OPEN
- Ingress: BALANCE_UPDATED, DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, GO_LIVE_CONFIRMED, NOTIFICATION_CREATED, ONBOARDING_COMPLETED, USER_REGISTERED, WITHDRAWAL_FAILED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
<!-- /card-drift:ingress -->
- InvestorBus → investor-bff-Ingress (SQS → Lambda, event-listener.ts)
  Subscriptions: USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED
- InvestorBus → investor-bff-BroadcastIngress (SQS → Lambda, broadcast-listener.ts)
  Subscriptions: BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, DEPOSIT_DETECTED

## Event contracts (producer surface)
- `src/domain/contracts.ts` exported as `@nestfolio/investor-bff/contracts` (zod-only, no service deps; event-subject-payload tripwire). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
  - `InvestorProfileUpdatedSchema` / `InvestorProfileUpdated` — subject for INVESTOR_PROFILE_CREATED/UPDATED (the domain fields: operatingMode, goal, riskProfile, onboardingCompletedAt, __version); consumed by dashboard-bff's InvestorSnapshot transform via `parseSubject`. Composed from `InvestorProfileGoalSchema` + `InvestorProfileRiskSchema` (also exported).
  - `NotificationReadSchema` / `NotificationRead` — subject for NOTIFICATION_READ (the Notification read-model row, sk='Notification#…'); unconsumed cross-domain (intra-service only), so its schema lives here rather than in investor-adpt.
- DEPOSIT_INITIATED/WITHDRAWAL_INITIATED subjects are cross-domain (consumed by broker-ctrl); their schemas live in `@nestfolio/investor-adpt/domain`, not here.

## Egress (CDC, 6 entity types — 3-tier topology on InvestorProfile)
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- DepositIntent: DEPOSIT_INITIATED
- ExecutionModeChange: EXECUTION_MODE_CHANGED, EXECUTION_MODE_CHANGE_UPDATED
- InvestorProfile: GOAL_UPDATED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED
- Mandate: MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED
- Notification: NOTIFICATION_READ
- WithdrawalIntent: WITHDRAWAL_INITIATED
<!-- /card-drift:egress -->
- DynamoDB Streams → investor-bff-egress (Lambda)
- Declarative `eventTypes` map:
  - InvestorProfile (composite row) → INVESTOR_PROFILE_CREATED (insert); on modify: INVESTOR_PROFILE_UPDATED (carrier, always) + GOAL_UPDATED (semantic, onFieldChange:goal)
  - Mandate (sibling row, sk='Mandate') → MANDATE_ISSUED (insert, lifecycle); on modify: OPERATING_MODE_CHANGED (onFieldChange:operatingMode), MANDATE_REVOKED (onFieldChange:status)
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
- updateOperatingMode resolver issues an atomic `TransactWriteItems` writing BOTH the InvestorProfile composite row (bumps its own `__version`, keeps INVESTOR_PROFILE_UPDATED firing for dashboard-bff's InvestorSnapshot) AND the Mandate sibling row (bumps the Mandate `__version`, re-sources OPERATING_MODE_CHANGED from the Mandate row's CDC). TransactWriteItems returns no attributes; a `get-profile.fn.js` readback step (pipeline extraSteps) fetches and returns the InvestorProfile.

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- broadcast-listener.ts
<!-- /card-drift:handlers -->
- event-listener.ts — materializes USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED (transactWrite: composite InvestorProfile + Mandate sibling row + conditional Deposit), GO_LIVE_CONFIRMED (`parseSubject(payload, GoLiveConfirmedSchema)` then sets executionMode='live' on the composite row); also routes broker funding lifecycle (DEPOSIT_*/WITHDRAWAL_*) to the deposit-/withdrawal-lifecycle transforms. Each transform validates its inbound subject at runtime via `parseSubject(payload, <producer Schema>)` rather than local types/`as` casts.
- broadcast-listener.ts — BROKER_CIRCUIT_OPEN disables 3 feature flags (confirmDecision, initiateDeposit, requestWithdrawal) via IAM-signed AppSync mutation; BROKER_CIRCUIT_CLOSED re-enables them; DEPOSIT_DETECTED published to investor-facing notification flow
- event-publisher.ts — CDC (changeDataCapture) using the declarative eventTypes map (typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- deposit-publisher.ts — `DepositBroadcaster` (Broadcaster construct): DDB-stream-driven; fans Deposit/WithdrawalRequest P1 row status transitions out via @aws_subscribe (onDepositUpdate / onWithdrawalUpdate). SECOND stream consumer on the table (Egress CDC is first). DLQ + bisectBatchOnError owned by the construct.

## Feature Flags (Circuit Breaker)
- BroadcastIngress handler env: APPSYNC_URL (from facade.graphqlUrl)
- BroadcastIngress IAM: appsync:GraphQL grant on Facade API
- AppSync mutations signed via @smithy/signature-v4 + @aws-crypto/sha256-js

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- InvestorBffEventTypes: ACCOUNT_CLOSED, ACCOUNT_CLOSURE_REQUESTED, BROKER_AUTHORIZATION_REVOKED, BROKER_CIRCUIT_CLOSED, BROKER_CIRCUIT_OPEN, DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_INITIATED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, EXECUTION_MODE_CHANGE_UPDATED, EXECUTION_MODE_CHANGED, GO_LIVE_CONFIRMED, GOAL_UPDATED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED, NOTIFICATION_READ, ONBOARDING_ANSWER_RECORDED, ONBOARDING_COMPLETED, OPERATING_MODE_CHANGED, PII_REMOVED, TENANT_ANONYMIZED, USER_AUTHENTICATED, USER_DELETION_REQUESTED, USER_REGISTERED, USER_SESSION_EXPIRED, WITHDRAWAL_FAILED, WITHDRAWAL_INITIATED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
<!-- /card-drift:event-types -->
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
- Unit: service.stack.test.ts (Broadcaster wiring: every DDB-stream consumer — Egress CDC + DepositBroadcaster — has DLQ + bisectBatchOnError), handlers/event-listener.test.ts, repositories/investor-profile.repository.test.ts, transforms/balance-updated.test.ts, transforms/user-registered.test.ts, transforms/notification-created.test.ts, transforms/onboarding-completed.test.ts, graphql/* (resolver fn unit tests)
- Integration: investor-bff.integration.test.ts (composite-row materialization, AppSync mutations including revokeMandate, AppSync queries, circuit breaker feature flags)

## Dependencies
- libs: cdk-constructs/core, event-processor
- event-name imports: investor-ctrl/events (InvestorCtrlEventTypes), investor-adpt/domain (InvestorIngestEventTypes), ledger-adpt/domain (LedgerCrossDomainEventTypes)
- zod payload-contract imports (event-subject-payload tripwire — consumers `parseSubject(payload, Schema)`, no local types/`as` casts): ledger-adpt/domain (BalanceUpdatedSchema), investor-ctrl/contracts (NotificationCreatedSchema), onboarding-bff/contracts (GoLiveConfirmedSchema, OnboardingCompletedRecordSchema), execution-adpt/domain (FundingSnapshotSchema)
- runtime deps: @smithy/signature-v4, @aws-crypto/sha256-js (for IAM-signed AppSync calls), zod (payload contracts)

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- CashBalance
- Deposit
- DepositIntent
- ExecutionModeChange
- InvestorProfile
- Mandate
- Notification
- WithdrawalIntent
- WithdrawalRequest
<!-- /card-drift:ddb-entities -->
