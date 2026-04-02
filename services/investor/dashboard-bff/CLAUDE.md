# dashboard-bff

Domain: investor | Bus: InvestorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- InvestorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED

## Facade
- AppSync GraphQL API with JS resolvers (discoverJsResolvers)
  - get-dashboard, get-position-snapshots, get-simulation-summary, get-time-travel-availability, get-recent-activity

## Handlers
- event-listener.ts — materializes dashboard projections via transforms: portfolioSummary, positionSnapshot, recentActivity, advisoryStatus, investorSnapshot, timeTravelAvailability

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
- libs: cdk-constructs/core, event-processor
- cross-domain imports: ledger-adpt/domain, advisory-adpt/domain, investor-bff/events
