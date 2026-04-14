# compliance-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/compliance-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → compliance-ctrl-ingress (SQS → Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED

## Egress
- CDC: DynamoDB Streams → compliance-ctrl-egress (Lambda)
  Emits:
  - ComplianceCheck → insert: field dispatch on `result` — APPROVED → DECISION_APPROVED, BLOCKED → DECISION_BLOCKED
  - AuditArtifact → AUDIT_ARTIFACT

## Handlers
- event-listener.ts — Ingress event handler
  - DECISION_PACKET_CREATED / DECISION_PACKET_UPDATED: loads MandateSnapshot from DDB, runs RuleEngine (MandateValidator + GuardrailEvaluator + SuitabilityChecker + AuthorityResolver), writes ComplianceCheck + AuditArtifact records
  - Authority resolution uses mode-derived guardrail thresholds from the mandate snapshot (maxSingleTradePercent as % of portfolioValue, monthlyTurnoverCapPercent as % of portfolioValue); ADVISORY mandate always resolves L2
  - MANDATE_CREATED / MANDATE_UPDATED: projects MandateSnapshot with all 8 guardrail fields (level, monthlyTurnoverCapPercent, maxSingleTradePercent, equityRiskBandPercent, driftTriggerPercent, singleEtfConcentrationPercent, drawdownCircuitBreakerPercent, effectiveDate/revokedAt)
  - OPERATING_MODE_CHANGED: skip (no-op)
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- ComplianceEventTypes: DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ESCALATION_TRIGGERED, COMPLIANCE_APPROVAL_GRANTED, AUDIT_ARTIFACT_CREATED, SUITABILITY_CHECK_PASSED, SUITABILITY_CHECK_FAILED

## Tests
- authority-resolver.test.ts
- compliance.repository.test.ts
- event-listener.test.ts
- guardrail-evaluator.test.ts
- mandate-validator.test.ts
- rule-engine.test.ts
- suitability-checker.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor
