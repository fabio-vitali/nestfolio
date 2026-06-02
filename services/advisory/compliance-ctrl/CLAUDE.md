# compliance-ctrl

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/compliance-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled). Stores GuardrailPolicy rows (MandateSnapshot): `{level, status, operatingMode, effectiveDate}`. GUARDRAIL_TABLE params (8 numeric thresholds per level) are hardcoded in `src/rules/guardrail-params.ts` — moved here from investor-bff in the domain resplit.

## Ingress
- advisoryBus → compliance-ctrl-ingress (SQS → Lambda)
  Subscriptions: RECOMMENDATION_PROPOSED, MANDATE_ISSUED, OPERATING_MODE_CHANGED, MANDATE_REVOKED

Post-resplit (2026-05-08): subscribes to semantic/lifecycle events directly instead of carrier events. MANDATE_ISSUED bootstraps the GuardrailPolicy on onboarding; OPERATING_MODE_CHANGED re-projects the policy when mode changes; MANDATE_REVOKED sets MandateSnapshot.status='REVOKED'. No longer subscribes to INVESTOR_PROFILE_CREATED or INVESTOR_PROFILE_UPDATED.

## Egress
- CDC: DynamoDB Streams → compliance-ctrl-egress (Lambda)
  Emits:
  - ComplianceCheck → insert: field dispatch on `result` — APPROVED → DECISION_APPROVED, BLOCKED → DECISION_BLOCKED
  - AuditArtifact → insert: AUDIT_ARTIFACT_CREATED, modify: AUDIT_ARTIFACT_UPDATED

## Handlers
- event-listener.ts — Ingress event handler
  - RECOMMENDATION_PROPOSED: loads GuardrailPolicy (MandateSnapshot) from DDB, runs RuleEngine (MandateValidator + GuardrailEvaluator + SuitabilityChecker + AuthorityResolver), writes ComplianceCheck + AuditArtifact records. Requires `taskToken` on subject (SF callback to decision-workflow-ctrl on DECISION_APPROVED|BLOCKED). Throws NotRetryableError if taskToken missing or required fields absent.
  - MANDATE_ISSUED: projects GuardrailPolicy (MandateSnapshot `{level, status, operatingMode, effectiveDate}`) from the Mandate row payload. The 8 numeric guardrail thresholds are looked up from `guardrail-params.ts` by level + operatingMode.
  - OPERATING_MODE_CHANGED: re-projects the GuardrailPolicy with the new operatingMode — updates the stored MandateSnapshot so the next RECOMMENDATION_PROPOSED uses the correct thresholds.
  - MANDATE_REVOKED: sets MandateSnapshot.status='REVOKED' + revokedAt; MandateValidator's REVOKED gate short-circuits the rule engine for any subsequent RECOMMENDATION_PROPOSED.
- event-publisher.ts — Egress CDC publisher

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P2 (append-only logs via record, idempotent/order-independent): ComplianceCheck, AuditArtifact
- Enforced by `nx run compliance-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

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
