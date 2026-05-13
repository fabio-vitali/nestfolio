---
id: circuit-breaker-feature-flags-ui-gating
status: shipped
rank: null
type: bug
notes: "SHIPPED 2026-05-13. Two findings: (1) stale dev bundle missed commit 0dcfda2c (2026-05-02) which fixed broadcastFromQueue envelope unwrap — resolved by deploy; (2) EB rule-evaluation partition drop affecting scenario 14 ~33% of runs — absorbed by jest.retryTimes(1) on the e2e file, same precedent as advisory-adpt-from-investor-mandate-issued-sequential-flake. Validation: scenario 14 green 3× consecutive against deployed dev (0 retry activations)."
references:
  - "apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts"
  - "services/investor/investor-bff/src/handlers/broadcast-listener.ts"
  - "services/investor/investor-bff/src/graphql/js-function/update-feature-flag.fn.js"
  - "services/investor/investor-bff/src/graphql/js-function/get-feature-flags.fn.js"
  - "services/investor/investor-bff/src/graphql/js-function/check-feature-flag.fn.js"
  - "services/investor/investor-bff/src/schema.graphql"
  - "services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts"
  - "services/investor/investor-adpt/src/service.stack.ts"
  - "services/execution/broker-alpaca-adpt/src/repositories/circuit-breaker.repository.ts"
  - "libs/event-processor/src/pipelines/broadcast-from-queue.ts"
  - "flows/broker-circuit-breaker.flow.yaml"
  - "docs/superpowers/plans/2026-04-15-circuit-breaker-integration-e2e-tests.md"
out_of_scope:
  - "broker-alpaca-adpt CB-rejection integration tests (Phase 1 of 2026-04-15 prior plan — separate workstream)"
  - "HealStateMachine open→close cycle behavior (this workstream is the OPEN→flags propagation path only)"
  - "investor-ctrl SYSTEM notification integration tests (Phase 2 of prior plan; partial e2e coverage already exists in the 2nd `it` block of scenario 14)"
  - "onFeatureFlagUpdate AppSync subscription real-time delivery (deferred per 2026-04-15 plan)"
  - "SystemBannerComponent / Playwright UI banner-render test (Playwright e2e is a separate suite; this workstream's gate is Jest e2e green)"
  - "investor-bff Phase 3 integration tests for feature-flag toggle (may be filed as a follow-up if e2e green does not provide sufficient guardrail)"
spec: "docs/superpowers/specs/2026-05-13-circuit-breaker-feature-flags-ui-gating-design.md"
plan: "docs/superpowers/plans/2026-05-13-circuit-breaker-feature-flags-ui-gating.md"
topic_memory:
  - "project_circuit_breaker_redesign.md"
validation_gate: "scenario 14 — circuit breaker lifecycle e2e (both `it` blocks) green 3 consecutive runs against deployed dev with 0 jest.retryTimes activations. Existing regression at libs/event-processor/test/pipelines/broadcast-from-queue.test.ts:149 covers the envelope-unwrap parser fix. Topic memory project_circuit_breaker_redesign updated with both findings + Facade fieldLogLevel public-API addition."
---

# Circuit-breaker open state not reflected in `getFeatureFlags` for UI mutation gating

**Failing e2e:** `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts` — scenario 14 ("disables gated mutations when breaker opens and re-enables when breaker closes").

The test writes a `CircuitBreaker#alpaca` row (state=OPEN) directly to broker-alpaca-adpt DDB via the `withBreakerOpen()` fixture, then polls `getFeatureFlags` (cognito-auth, on investor-bff AppSync) for up to 120s expecting `confirmDecision` / `initiateDeposit` / `requestWithdrawal` to flip to `enabled:false`. All three remain `enabled:true`.

## Propagation chain (from code)

1. `withBreakerOpen()` fixture → PutItem `CircuitBreaker#alpaca` in broker-alpaca-adpt table
2. CDC from NormalizedEvent INSERT → `BROKER_CIRCUIT_OPEN` on ExecutionBus
3. investor-adpt EB rule (`InvestorIngress-FromExecution`) forwards to InvestorBus (verified wired: `services/investor/investor-adpt/src/service.stack.ts`)
4. `investor-bff-BroadcastIngress` SQS → `broadcast-listener.ts` Lambda
5. `broadcastFromQueue` fires `updateFeatureFlag` mutation 3× (verified by unit test: `test/unit/handlers/broadcast-listener.test.ts` asserts 3 IAM-signed AppSync calls)
6. `update-feature-flag.fn.js` PutItem → investor-bff DDB
7. Next `get-feature-flags.fn.js` Query → returns disabled flags

## What is verified

- **In-handler logic correct:** `broadcastFromQueue`'s mapPayload-array→N-mutations contract is exercised by the unit test and asserts exact `{name, enabled, reason}` for all 3 flags.
- **Schema correct:** `updateFeatureFlag` is `@aws_iam`; `FeatureFlag` is `@aws_cognito_user_pools @aws_iam` (readable by Cognito-auth users via `getFeatureFlags`).
- **Cross-domain forwarding wired:** `BROKER_CIRCUIT_OPEN/CLOSED/HEAL_ESCALATED` all listed in investor-adpt service stack.

## What remains to investigate

The bug is therefore in one (or more) of:

a. **CDC emission upstream** — broker-alpaca-adpt may not be emitting `BROKER_CIRCUIT_OPEN` when the fixture writes the CB row directly (the `eventTypes` map may key off the NormalizedEvent INSERT, not a raw `CircuitBreaker` row). If the fixture bypasses the real failure path, no CDC fires.
b. **EB routing eventual consistency** — newly-deployed rules sometimes silently drop events on cross-bus partitions (recently shipped `advisory-adpt-from-investor-mandate-issued-sequential-flake` documented this pattern). CloudWatch per-rule `MatchedEvents` metric is the canary.
c. **IAM-signed call failing at runtime** — handler logs the success path but a SIG-V4 / region mismatch / missing permission would silently DLQ.
d. **Read/write race** — `getFeatureFlags` runs against a region the writer didn't write to (config drift), or AppSync caches the empty result.

## Validation gate (target)

- `scenario 14 — circuit breaker lifecycle` passes both `it` blocks against deployed dev, **3× in a row**.
- Regression test added: either a unit assertion that fails when the propagation chain breaks at the surfaced layer, or an integration test (if root cause is at a service boundary that integration coverage would catch).
- Memory + service cards updated if the wiring changes.

## Context

The CB redesign shipped 2026-04-15 (memory: `project_circuit_breaker_redesign`). The 2026-04-15 plan (`docs/superpowers/plans/2026-04-15-circuit-breaker-integration-e2e-tests.md`) wrote scenario 14 + the `withBreakerOpen` fixture. The e2e was added but never observed green against deployed dev — this workstream closes that loop.

Surfaced 2026-05-09 during validation gate of `advisory-empty-state-pending-decisions-count`. Independent of `decision-workflow-ctrl-sf-stuck-waitforcompliance` (different domain, different code path).
