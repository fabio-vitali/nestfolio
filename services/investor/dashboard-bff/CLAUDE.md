# dashboard-bff

Domain: investor | Bus: investorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- investorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED

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
