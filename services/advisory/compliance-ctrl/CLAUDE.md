# compliance-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/compliance-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → compliance-ctrl-ingress (SQS → Lambda)
  Subscriptions: RECOMMENDATION_PROPOSED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_REVOKED

Post-collapse: legacy MANDATE_CREATED + MANDATE_UPDATED + OPERATING_MODE_CHANGED replaced by INVESTOR_PROFILE_CREATED + INVESTOR_PROFILE_UPDATED + MANDATE_REVOKED. The composite events carry the mandate sub-payload that MandateSnapshot is projected from; MANDATE_REVOKED sets MandateSnapshot.status='REVOKED' which the rule engine short-circuits on.

## Egress
- CDC: DynamoDB Streams → compliance-ctrl-egress (Lambda)
  Emits:
  - ComplianceCheck → insert: field dispatch on `result` — APPROVED → DECISION_APPROVED, BLOCKED → DECISION_BLOCKED
  - AuditArtifact → insert: AUDIT_ARTIFACT_CREATED, modify: AUDIT_ARTIFACT_UPDATED

## Handlers
- event-listener.ts — Ingress event handler
  - RECOMMENDATION_PROPOSED: loads MandateSnapshot from DDB, runs RuleEngine (MandateValidator + GuardrailEvaluator + SuitabilityChecker + AuthorityResolver), writes ComplianceCheck + AuditArtifact records. Requires `taskToken` on subject (SF callback to decision-workflow-ctrl on DECISION_APPROVED|BLOCKED). Throws NotRetryableError if taskToken missing or required fields absent.
  - INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED: projects GuardrailPolicy (MandateSnapshot) with 8 guardrail fields (level, monthlyTurnoverCapPercent, maxSingleTradePercent, equityRiskBandPercent, driftTriggerPercent, singleEtfConcentrationPercent, drawdownCircuitBreakerPercent, effectiveDate). Reads `mandate` + `operatingMode` from the composite payload.
  - MANDATE_REVOKED: sets MandateSnapshot.status='REVOKED' + revokedAt; MandateValidator's REVOKED gate short-circuits the rule engine for any subsequent RECOMMENDATION_PROPOSED.
- event-publisher.ts — Egress CDC publisher

## Event Types (domain/events.ts)
- ComplianceEventTypes (outbound, via CDC): DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ESCALATION_TRIGGERED, COMPLIANCE_APPROVAL_GRANTED, AUDIT_ARTIFACT_CREATED, SUITABILITY_CHECK_PASSED, SUITABILITY_CHECK_FAILED, AUDIT_ARTIFACT_UPDATED

## Tests
- test/unit/authority-resolver.test.ts
- test/unit/compliance.repository.test.ts
- test/unit/event-listener.test.ts
- test/unit/guardrail-evaluator.test.ts
- test/unit/mandate-validator.test.ts
- test/unit/rule-engine.test.ts
- test/unit/suitability-checker.test.ts
- test/integration/compliance-ctrl.integration.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor, decision-workflow-ctrl/events, advisory-adpt/domain, investor-bff/events
