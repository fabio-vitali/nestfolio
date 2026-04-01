# compliance-ctrl

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/compliance-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- AdvisoryBus -> compliance-ctrl-ingress (SQS -> Lambda)
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED

## Egress
- CDC: DynamoDB Streams -> compliance-ctrl-egress (Lambda)
  Emits: ComplianceCheck, AuditArtifact

## Handlers
- event-listener.ts
- event-publisher.ts

## Tests
- authority-resolver.test.ts
- compliance.repository.test.ts
- event-listener.test.ts
- guardrail-evaluator.test.ts
- mandate-validator.test.ts
- rule-engine.test.ts
- suitability-checker.test.ts

## Dependencies
- libs: cdk-constructs (core)
