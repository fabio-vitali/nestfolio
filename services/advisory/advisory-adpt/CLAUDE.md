# advisory-adpt

Domain: advisory | Bus: AdvisoryBus (cross-domain adapter)
Stack: services/advisory/advisory-adpt/src/service.stack.ts

## State
None (stateless adapter, stateProps: false)

## Cross-Domain Routing Rules
- ToInvestor: AdvisoryBus -> InvestorBus (with DLQ)
  Routes: DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED

- ToExecution: AdvisoryBus -> ExecutionBus (with DLQ)
  Routes: DECISION_APPROVED, DECISION_PACKET_CREATED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
- Buses: AdvisoryBus, InvestorBus, ExecutionBus
