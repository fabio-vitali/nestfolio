# execution-adpt

Domain: execution | Bus: executionBus
Stack: services/execution/execution-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
- Advisory → Execution:
  Rule on advisoryBus → executionBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET

- Investor → Execution:
  Rule on investorBus → executionBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
  Events: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Event Types (domain/events.ts)
- ExecutionCrossDomainEventTypes: ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, ORDER_FILLED, ORDER_PARTIALLY_FILLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
- ExecutionIngestEventTypes: DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
