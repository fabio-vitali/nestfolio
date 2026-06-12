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
  - ComplianceCheck → insert: field dispatch on `result` — APPROVED → DECISION_APPROVED, BLOCKED → DECISION_BLOCKED [typed: ComplianceCheckSchema]
  (AuditArtifact row is still written but NOT CDC-emitted — AUDIT_ARTIFACT_CREATED + AUDIT_ARTIFACT_UPDATED were stop-emitted; zero consumers.)

## Handlers
- event-listener.ts — Ingress event handler
  - RECOMMENDATION_PROPOSED: loads GuardrailPolicy (MandateSnapshot) from DDB, runs RuleEngine (MandateValidator + GuardrailEvaluator + SuitabilityChecker + AuthorityResolver), writes ComplianceCheck + AuditArtifact records. Requires `taskToken` on subject (SF callback to decision-workflow-ctrl on DECISION_APPROVED|BLOCKED). Throws NotRetryableError if taskToken missing or required fields absent.
  - MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED: all three route to a single `projectMandateSnapshot` helper that calls `projectVersioned('MandateSnapshot', fullImage, { version: subject.__version, overrides: { pk, sk } })`. Every Mandate event now carries the full Mandate image + Mandate `__version`; the version guard is the sole idempotency mechanism (the old REVOKED-skip conditional is gone). Missing `operatingMode` throws NotRetryableError; missing `__version` returns `skip()`.
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt. Exempt: none (every emitted __typename now has a row-level contract — ComplianceCheck → ComplianceCheckSchema).

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P2 (append-only logs via record, idempotent/order-independent): ComplianceCheck, AuditArtifact
  - P1 (versioned snapshot via projectVersioned, version-guarded): MandateSnapshot — mirror of the investor-bff Mandate aggregate, keyed on the Mandate `__version` carried by CDC (`read-model-ownership-mandate-projection-fix`, 2026-06-03). projectVersioned writes the full Mandate image; the `__version` guard subsumes the old REVOKED-skip idempotency.
- Enforced by `nx run compliance-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Types (domain/events.ts)
- ComplianceEventTypes (outbound, via CDC): DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ESCALATION_TRIGGERED, COMPLIANCE_APPROVAL_GRANTED, AUDIT_ARTIFACT_CREATED, SUITABILITY_CHECK_PASSED, SUITABILITY_CHECK_FAILED, AUDIT_ARTIFACT_UPDATED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/compliance-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/compliance-ctrl/contracts`. DRY domain subjects — identity travels in the event context (RequestContext), not on the subject. The old `domain/schemas.ts` (dead `DecisionApprovedSchema`/`DecisionBlockedSchema` — structurally wrong, unimported) was deleted and replaced by this contract.
- ComplianceCheckSchema / ComplianceCheck — `ComplianceCheck` row (sk='ComplianceCheck'), CDC value-mapped on `result`: DECISION_APPROVED (result=APPROVED) / DECISION_BLOCKED (result=BLOCKED). Fields: ccId, decisionPacketId, decisionId (dual-field alias), taskToken, mandateSnapshot:{level['ADVISORY'|'DISCRETIONARY'],status['ACTIVE'|'REVOKED'],operatingMode['CONSERVATIVE'|'BALANCED'|'AGGRESSIVE'],effectiveDate}, status['COMPLETED'|'BLOCKED'], result['APPROVED'|'BLOCKED'], violations:[{rule,description,severity['WARNING'|'BLOCKING']}], authorityLevel['L1'|'L2'], sourceEventId.

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
- libs: cdk-constructs (core), event-processor, decision-workflow-ctrl/events, advisory-adpt/domain, investor-adpt/domain
