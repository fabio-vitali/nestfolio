# investor-adpt

Domain: investor | Bus: investorBus
Stack: services/investor/investor-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- InvestorIngress-FromAdvisory: ADVISORY_STATUS_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, DECISION_PACKET_CREATED, ESCALATION_TRIGGERED, EXPLANATION_GENERATED, INCIDENT_DETECTED, INCIDENT_RESOLVED, USER_CONFIRMATION_REQUESTED
- InvestorIngress-FromExecution: BROKER_CIRCUIT_CLOSED, BROKER_CIRCUIT_OPEN, BROKER_HEAL_ESCALATED, DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ORDER_REJECTED, ORDER_STAGED, WITHDRAWAL_FAILED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
- InvestorIngress-FromLedger: BALANCE_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED
<!-- /card-drift:ingress -->
- Advisory → Investor:
  Rule on advisoryBus → investorBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, ADVISORY_STATUS_UPDATED

- Execution → Investor:
  Rule on executionBus → investorBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)
  Events: ORDER_STAGED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED

- Ledger → Investor:
  Rule on ledgerBus → investorBus (DLQ: FromLedgerDLQ, 14-day retention, KMS encrypted)
  Events: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED (Task 17)

## EB Rule Source Filters
All 3 rules use $or pattern: non-integration-test source OR integration-test:investor-adpt source

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- InvestorCrossDomainEventTypes: ACCOUNT_CLOSURE_REQUESTED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED
- InvestorIngestEventTypes: ADVISORY_STATUS_UPDATED, BALANCE_UPDATED, BROKER_CIRCUIT_CLOSED, BROKER_CIRCUIT_OPEN, BROKER_HEAL_ESCALATED, DECISION_APPROVED, DECISION_BLOCKED, DECISION_PACKET_CREATED, DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, ESCALATION_TRIGGERED, EXPLANATION_GENERATED, INCIDENT_DETECTED, INCIDENT_RESOLVED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ORDER_REJECTED, ORDER_STAGED, PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, USER_CONFIRMATION_REQUESTED, WITHDRAWAL_FAILED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
<!-- /card-drift:event-types -->
- InvestorCrossDomainEventTypes: ACCOUNT_CLOSURE_REQUESTED only (consumed by execution-ctrl/handlers/event-listener.ts). All other outbound investor event names are owned by InvestorBffEventTypes / BrokerCtrlInboundEventTypes / ExecutionIngestEventTypes — not this map.
- InvestorIngestEventTypes: DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, ADVISORY_STATUS_UPDATED, ORDER_STAGED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED, BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED (Task 16–17)

## Event Payload Contracts (domain/contracts.ts)
Producer-owned zod payload contracts, re-exported via the `/domain` barrel (consumers import from `@nestfolio/investor-adpt/domain`). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- DepositInitiatedSchema / DepositInitiated — DEPOSIT_INITIATED subject (from investor-bff DepositIntent row); consumed by broker-ctrl to route deposits
- WithdrawalInitiatedSchema / WithdrawalInitiated — WITHDRAWAL_INITIATED subject (from investor-bff WithdrawalIntent row); consumed by broker-ctrl to route withdrawals
- MandateSchema / Mandate — MANDATE_ISSUED / MANDATE_REVOKED / OPERATING_MODE_CHANGED subject (the Mandate sibling row, sk='Mandate', from investor-bff); consumed cross-domain by compliance-ctrl (advisory). OPERATING_MODE_CHANGED is re-sourced from it.
- ExecutionModeChangedSchema / ExecutionModeChanged — EXECUTION_MODE_CHANGED / EXECUTION_MODE_CHANGE_UPDATED subject (the ExecutionModeChange audit row from investor-bff); consumed cross-domain by broker-ctrl (execution).
Owned in the producer's cross-domain adapter (ProposedTrade/DepositInitiated precedent); breaks circular dependencies between investor-bff and cross-domain consumers.

## Tests
- Unit: test/unit/service.stack.test.ts

Domain adapters are pure EB rule forwarders (no handlers, no DDB). Per-adapter integration tests were removed 2026-05-13 — coverage is the CDK snapshot test + e2e flows that cross the forwarding hop via downstream consumers.

## Dependencies
- libs: cdk-constructs (core, observability, extensions, utils), event-types
- npm: zod (payload contract schemas in domain/contracts.ts)
