# investor-adpt

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-adpt/src/service.stack.ts

## State
None (stateless adapter, stateProps: false)

## Cross-Domain Forwarding Rules
- InvestorBus → AdvisoryBus:
  GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED
- InvestorBus → ExecutionBus:
  DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## DLQs
- ToAdvisoryDLQ, ToExecutionDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- InvestorCrossDomainEventTypes: GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
