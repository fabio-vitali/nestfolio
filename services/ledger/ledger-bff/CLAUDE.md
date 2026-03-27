# ledger-bff

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- LedgerBus → ledger-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - Excludes from JS: getPortfolioAt, getSimulationComparison (handled by Lambda resolver)
  - Lambda resolvers:
    - Query.getPortfolioAt → GraphqlResolver Lambda
    - Query.getSimulationComparison → GraphqlResolver Lambda
  - Auth: Cognito UserPool (referenced via SSM)

## Handlers
- event-listener.ts
- graphql-resolver.ts

## Tests
- service.stack.test.ts
- repositories/portfolio.repository.test.ts
- transforms/portfolio-updated.test.ts
- transforms/balance-updated.test.ts
- transforms/ledger-entry-recorded.test.ts
- handlers/event-listener.test.ts
- handlers/graphql-resolver.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils
