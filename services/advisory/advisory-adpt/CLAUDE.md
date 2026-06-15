# advisory-adpt

Domain: advisory | Bus: AdvisoryBus
Stack: `services/advisory/advisory-adpt/src/service.stack.ts`
Tags: `scope:advisory`, `type:adpt`

## State

None (stateless adapter -- EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- AdvisoryIngress-FromExecution: DEPOSIT_DETECTED, ORDER_CANCELLED, ORDER_FILLED, ORDER_REJECTED
- AdvisoryIngress-FromInvestor: INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REAFFIRMED, MANDATE_REVOKED, OPERATING_MODE_CHANGED
- AdvisoryIngress-FromLedger: PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_UPDATED
<!-- /card-drift:ingress -->

### Investor -> Advisory
Rule on InvestorBus -> AdvisoryBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)

The carrier (INVESTOR_PROFILE_UPDATED) is forwarded for decision-workflow-ctrl re-decision triggers. MANDATE_ISSUED + OPERATING_MODE_CHANGED feed decision-workflow-ctrl's MandateProjectorIngress (operating-mode-lookup, 2026-05-10). MANDATE_REVOKED + OPERATING_MODE_CHANGED feed compliance-ctrl. INVESTOR_PROFILE_CREATED was dropped 2026-05-10 — zero advisoryBus consumers post-migration to MANDATE_SNAPSHOT_CREATED-driven first decision.

### Execution -> Advisory
Rule on ExecutionBus -> AdvisoryBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)

### Ledger -> Advisory
Rule on LedgerBus -> AdvisoryBus (DLQ: FromLedgerDLQ, 14-day retention, KMS encrypted)

## Egress

None (adapter does not emit events)

## Standalone Lambdas

None (no handlers -- pure EB rule forwarding)

## Facade

None

## Orchestration

None

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- AdvisoryCrossDomainEventTypes: ADVISORY_STATUS_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, DECISION_PACKET_CREATED, EXPLANATION_GENERATED, USER_CONFIRMED
- AdvisoryIngestEventTypes: DEPOSIT_DETECTED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REAFFIRMED, MANDATE_REVOKED, OPERATING_MODE_CHANGED, ORDER_CANCELLED, ORDER_FILLED, ORDER_REJECTED, PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_UPDATED
<!-- /card-drift:event-types -->

## Event Payload Contracts (domain/contracts.ts → @nestfolio/advisory-adpt/contracts)
Producer-owned zod value-object contracts, exported via `@nestfolio/advisory-adpt/contracts` (new subpath) AND re-exported via the existing `@nestfolio/advisory-adpt/domain` barrel — the cross-domain import path for execution-ctrl consumers is unchanged. `ProposedTrade` was previously a plain TypeScript interface; it is now a zod-validated schema.
- ProposedTradeSchema / ProposedTrade — value object nested in decision/order subjects (proposedTrades array). Fields: symbol, assetClass, side['BUY'|'SELL'], quantityOrAmountCents, targetWeightPercent, rationale. DRY (no identity fields).

## Tests

- `test/service.stack.test.ts` -- CDK snapshot assertions (3 rules, 3 DLQs, tags)

Domain adapters are pure EB rule forwarders (no handlers, no DDB). The CDK snapshot test verifies rule shape; e2e feature tests exercise the forwarding hop end-to-end via downstream consumers. Per-adapter integration tests were removed 2026-05-13 — they hit an EventBridge rule-propagation race in `EventBusTrap` that was inherent to ephemeral test-time rules and could not be eliminated without bus-level architectural change.

## Dependencies

- `@nestfolio/cdk-constructs` (core, observability, extensions)
- `@nestfolio/event-types` (eventName branded type)
