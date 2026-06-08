# ledger-bff

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- LedgerBus → ledger-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED

## Facade
- AppSync GraphQL API
  - JS resolvers (discoverJsResolvers, excludes getPortfolioAt and getSimulationComparison):
    - get-balance.fn.js
    - get-order-history.fn.js
    - get-performance.fn.js
    - get-portfolio.fn.js
    - get-positions.fn.js
    - get-time-travel-availability.fn.js
    - utils/check-auth.fn.js
  - Lambda resolvers:
    - Query.getPortfolioAt → GraphqlResolver Lambda
    - Query.getSimulationComparison → GraphqlResolver Lambda
  - Auth: Cognito UserPool (SSM: /nestfolio/{prefix}-investor/auth/userPoolId)

## MFE Hosting
- MfeBucket (mfeKey=ledger): S3 bucket "{account}-{prefix}-nestfolio-mfe-ledger"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Handlers
- event-listener.ts — materializeToTable pipeline; handles BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED via transform functions (each transform validates the payload at runtime with parseSubject against the producer's zod contract)
- graphql-resolver.ts — AppSync Lambda resolver; handles getPortfolioAt (time-travel via snapshot replay) and getSimulationComparison (actual vs simulated portfolio diff)

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (versioned snapshots via projectVersioned, keyed on lastEventSequence): PortfolioLatest, Position, Simulation, SimulationPosition
  - P2 (append-only logs via record, idempotent/order-independent): SnapshotAt, HistoryEntry, Checkpoint

## Tests
- test/unit/service.stack.test.ts
- test/unit/handlers/event-listener.test.ts
- test/unit/handlers/graphql-resolver.test.ts
- test/unit/repositories/portfolio.repository.test.ts
- test/unit/transforms/balance-updated.test.ts
- test/unit/transforms/ledger-entry-recorded.test.ts
- test/unit/transforms/portfolio-updated.test.ts
- test/unit/version-guard.test.ts
- test/types/read-model-ownership.type-test.ts
- test/integration/ledger-bff.integration.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils, event-processor
- cross-domain: @nestfolio/ledger-ctrl/events (event-type constants), @nestfolio/ledger-ctrl/contracts (zod payload schemas: BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema — consumed via parseSubject in transforms)
