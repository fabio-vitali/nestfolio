# dashboard-bff

Domain: investor | Bus: investorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- investorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED
  + Phase 2 additions: ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_DRIFT_DETECTED, DEPOSIT_DETECTED

The post-collapse subscription list replaces the legacy 6 per-entity events (GOAL_*, RISK_PROFILE_*, OPERATING_MODE_*) with the 2 composite events. The investor-snapshot transform reads goal, riskProfile, and operatingMode from the composite payload of INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED. INVESTOR_PROFILE_CREATED stays subscribed for InvestorSnapshot materialization but no longer increments pendingDecisionsCount — the trigger-counting transform now uses MANDATE_ISSUED (the local investor-domain mandate-lifecycle signal). dashboard-bff intentionally tracks MANDATE_ISSUED rather than the advisory-domain MANDATE_SNAPSHOT_CREATED so the in-flight badge stays inside the investor domain (no cross-domain forwarding required).

## Transforms
- advisory-status.ts — maintains AdvisoryStatus.pendingDecisionsCount:
  - Increments (+1) on trigger events: MANDATE_ISSUED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
  - Decrements (−1) on DECISION_APPROVED, DECISION_BLOCKED
  - DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED no longer affect pendingDecisionsCount (repurposed to recent-activity.ts)
- recent-activity.ts — dispatches DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED to the activity feed (phase 2 dispatch)
- investor-snapshot.ts — reads goal, riskProfile, operatingMode from composite INVESTOR_PROFILE_* payload
- portfolio-summary.ts, position-snapshot.ts, time-travel-availability.ts — unchanged

## Facade
- AppSync GraphQL API (JS Resolvers via discoverJsResolvers)

## MFE Hosting
- MfeBucket (mfeKey=dashboard): S3 bucket "{account}-{prefix}-nestfolio-mfe-dashboard"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Handlers
- event-listener.ts — Ingress event handler

## Tests
- handlers/event-listener.test.ts
- repositories/dashboard.repository.test.ts
- transforms/advisory-status.test.ts
- transforms/investor-snapshot.test.ts
- transforms/portfolio-summary.test.ts
- transforms/position-snapshot.test.ts
- transforms/recent-activity.test.ts
- transforms/time-travel-availability.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor
