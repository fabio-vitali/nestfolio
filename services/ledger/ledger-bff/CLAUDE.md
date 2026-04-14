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

## Handlers
- event-listener.ts — materializeToTable pipeline; handles BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED via transform functions
- graphql-resolver.ts — AppSync Lambda resolver; handles getPortfolioAt (time-travel via snapshot replay) and getSimulationComparison (actual vs simulated portfolio diff)

## Tests
- service.stack.test.ts
- handlers/event-listener.test.ts
- handlers/graphql-resolver.test.ts
- repositories/portfolio.repository.test.ts
- transforms/balance-updated.test.ts
- transforms/ledger-entry-recorded.test.ts
- transforms/portfolio-updated.test.ts
- integration/ledger-bff.integration.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils, event-processor
- cross-domain: @nestfolio/ledger-ctrl/events
