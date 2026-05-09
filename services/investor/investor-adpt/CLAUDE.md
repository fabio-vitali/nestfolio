# investor-adpt

Domain: investor | Bus: investorBus
Stack: services/investor/investor-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
- Advisory → Investor:
  Rule on advisoryBus → investorBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED

- Execution → Investor:
  Rule on executionBus → investorBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)
  Events: ORDER_STAGED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED

- Ledger → Investor:
  Rule on ledgerBus → investorBus (DLQ: FromLedgerDLQ, 14-day retention, KMS encrypted)
  Events: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED (Task 17)

## EB Rule Source Filters
All 3 rules use $or pattern: non-integration-test source OR integration-test:investor-adpt source

## Event Types (domain/events.ts)
- InvestorCrossDomainEventTypes: GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED (legacy names; not used in forwarding rules — the EB rules use InvestorBffEventTypes from investor-bff/events)
- InvestorIngestEventTypes: DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, ORDER_STAGED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED, BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED (Task 16–17)

## Tests
- Unit: test/unit/service.stack.test.ts
- Integration: test/integration/from-advisory.integration.test.ts, from-execution.integration.test.ts, from-ledger.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions), event-types
