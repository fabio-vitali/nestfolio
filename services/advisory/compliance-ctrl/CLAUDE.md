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
  - MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED: all three route to a single `projectMandateSnapshot` helper that calls `projectVersioned('MandateSnapshot', fullImage, { version: subject.__version, overrides: { pk, sk } })`. Every Mandate event now carries the full Mandate image + Mandate `__version`; the version guard is the sole idempotency mechanism (the old REVOKED-skip conditional is gone). Missing `operatingMode` throws NotRetryableError; missing `__version` returns `skip()`.
- event-publisher.ts — Egress CDC publisher

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P2 (append-only logs via record, idempotent/order-independent): ComplianceCheck, AuditArtifact
  - P1 (versioned snapshot via projectVersioned, version-guarded): MandateSnapshot — mirror of the investor-bff Mandate aggregate, keyed on the Mandate `__version` carried by CDC (`read-model-ownership-mandate-projection-fix`, 2026-06-03). projectVersioned writes the full Mandate image; the `__version` guard subsumes the old REVOKED-skip idempotency.
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
