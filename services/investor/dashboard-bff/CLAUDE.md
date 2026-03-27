# dashboard-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)

## Handlers
- event-listener.ts

## Tests
- (test directory exists with test files)

## Dependencies
- libs: cdk-constructs/core
