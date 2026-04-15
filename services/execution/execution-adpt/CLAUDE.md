# execution-adpt

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-adpt/src/service.stack.ts`

## State
None (stateless adapter — EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)
- Advisory -> Execution:
  Rule on AdvisoryBus -> ExecutionBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_APPROVED, USER_CONFIRMED

- Investor -> Execution:
  Rule on InvestorBus -> ExecutionBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
  Events: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Egress
None (no CDC, no direct EB emission)

## Orchestration
None

## Standalone Lambdas
None

## Facade
None

## Handlers
None (no Lambda handlers — pure EB Rule forwarding)

## Event Types (`src/domain/events.ts`)
- ExecutionCrossDomainEventTypes: ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
- ExecutionIngestEventTypes: DECISION_APPROVED, USER_CONFIRMED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Tests
- `test/service.stack.test.ts` — CDK assertions (2 rules, DLQs, tags)
- `test/integration/from-advisory.integration.test.ts` — DECISION_APPROVED forwarding
- `test/integration/from-investor.integration.test.ts` — EXECUTION_MODE_CHANGED forwarding

## Dependencies
- libs: cdk-constructs (core, observability, extensions), event-types
- test libs: test-support, integration-testing
