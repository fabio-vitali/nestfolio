# compliance-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/compliance-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- advisoryBus → compliance-ctrl-ingress (SQS → Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED

## Egress
- CDC: DynamoDB Streams → compliance-ctrl-egress (Lambda)
  Emits: COMPLIANCE_CHECK (ComplianceCheck), AUDIT_ARTIFACT (AuditArtifact)

## Handlers
- event-listener.ts — Ingress event handler
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
