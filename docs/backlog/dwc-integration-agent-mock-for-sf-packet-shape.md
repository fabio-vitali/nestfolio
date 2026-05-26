---
id: dwc-integration-agent-mock-for-sf-packet-shape
status: active
rank: 4
type: tooling
notes: "Task 10 packet-shape integration test (decision-workflow-ctrl.integration.test.ts:534) needs full SF chain (PE+AN, 240s budget). Dev sandbox hits PE TaskTimedOut at 120s due to AgentCore maxVms saturation. CW evidence: execution arn fb73afaa-f6c0-4d6e-7aa4-c70d4f532072 entered InvokePortfolioEngine at 15:24:38, TaskTimedOut at 15:26:38 (exactly 120s). Currently it.skip'ped. Needs trap-based agent stub (CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE → fake _COMPLETED with synthetic agentOutput + captured taskToken) to bypass Bedrock and unblock the contract assertion. ALSO unblocks ferry-ledger-positions-to-advisory's DWC Tests 14+15 (LedgerSnapshot end-to-end SF chain, skipped at 8458e131). Scope is Jest integration only per user [[feedback-mock-all-external-apis]]; the parallel Playwright path apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts must NOT use the stub (real agents per [[feedback-e2e-no-external-mocks]]) and is filed separately as playwright-rebalance-real-agents-maxvms-remediation."
references:
  - path: services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
    anchor: L534
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: docs/superpowers/specs/2026-05-25-decision-pipeline-units-calibration-suitability-design.md
out_of_scope:
  - Mocking the real Bedrock InvokeAgentRuntime call (different layer — handled by SsmOverride / FakeLlm patterns).
  - Increasing AgentCore maxVms quota in the sandbox (covered by agentcore-maxvms-prod-quota-increase LATER item).
  - Production SF state-machine changes (the agent stub is test-side only — production SF stays unchanged).
  - Re-enabling integration tests that fail for reasons unrelated to PE/AN agent timeouts (separate flake categories filed under integration-deep-coldstart-flakes-post-trap-hardening).
  - Playwright apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts re-enabling — filed as playwright-rebalance-real-agents-maxvms-remediation because e2e policy forbids agent mocking and needs an infrastructure-layer maxVms fix.
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Test-side agent mock for SF→RECOMMENDATION_PROPOSED integration coverage

## Why this is queued (not parking)

Per [[feedback-e2e-gaps-queued-not-parking]]: this is an integration-suite coverage gap. The test exists, is correct, and would catch real contract regressions in the SF→AssemblePacket→Compliance handoff — it's just structurally blocked by the dev sandbox's AgentCore maxVms quota intermittently timing out PortfolioEngine. The gap is the test infrastructure, not the test design.

## Scope refinement (adoption 2026-05-26)

User policy splits the original 3 blocked artifacts into two lanes that need DIFFERENT mechanisms:

- **Integration lane (this workstream).** [[feedback-mock-all-external-apis]] says "ALL third-party + LLM calls must be mocked in integration tests." Jest integration tests are the right place for an agent stub — the trap-based design carries through unchanged for them.
- **E2E lane (filed separately).** [[feedback-e2e-no-external-mocks]] says e2e runs "real APIs, real LLMs, real keys, real rate limits." The Playwright path can NOT use the stub. The maxVms saturation has to be solved at the infrastructure layer for that path. Filed as `playwright-rebalance-real-agents-maxvms-remediation`.

## The blocked integration tests

1. **DWC Test 10** — `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts:534` (`decision-workflow-ctrl packet-shape contract (workstream 2026-05-25)`), `it.skip`-ped. Asserts the post-units-fix RECOMMENDATION_PROPOSED contract.
2. **DWC Tests 14 + 15** — same file, `LedgerSnapshot end-to-end SF chain` describe block, `it.skip`-ped at commit `8458e131` (ferry-ledger-positions-to-advisory workstream). Assert that LedgerSnapshot reaches AssemblePacket through a real SF execution and produces non-empty delta trades.

Both hit the same `InvokePortfolioEngine` → AgentCore Bedrock path and time out under dev sandbox maxVms saturation. The agent stub bypasses Bedrock for the SF chain so the contract assertions become deterministic.

### Original Test 10 assertions (unchanged)

The test seeds MandateSnapshot + InvestorProfileSnapshot via the natural event-publishing path, emits DEPOSIT_DETECTED with amountCents=100_000, then waits for RECOMMENDATION_PROPOSED to assert:

- `subject.portfolioValueCents === 100_000`
- `subject.isInitialBuild === true`
- `subject.riskCategory === 'MODERATE'`
- `subject.proposedTrades[0].quantityOrAmountCents === round(targetWeightPercent / 100 * 100_000)`

These assertions verify the post-fix contract end-to-end (Tasks 1-4 of the decision-pipeline-units-calibration-suitability workstream).

## Why it can't run today

The full SF chain requires PE + AN to complete within their 120s budgets each. Dev sandbox hits PE TaskTimedOut after exactly 120s when AgentCore maxVms quota is saturated (concurrent SF executions from MANDATE_SNAPSHOT_CREATED orphan + DEPOSIT_DETECTED + any other concurrent workload). This is known infrastructure pressure, not a new bug — see related backlog items `agentcore-maxvms-prod-quota-increase` (LATER) and the shipped `agentcore-maxvms-browser-path-resilience` (2026-05-24).

## Design sketch (informal — full brainstorm at adoption)

Two plausible approaches:

- **A — Trap-based agent stub.** The test fixture deploys a small EventBridge rule that listens for `CONSTRUCT_PORTFOLIO` events, extracts the `taskToken` from the subject, and immediately publishes `PORTFOLIO_COMPLETED` with synthetic `agentOutput` shaped like real PE output. Same for `GENERATE_NARRATIVE` → `NARRATIVE_COMPLETED`. Bypasses Bedrock entirely. Reusable for any DWC SF integration test that doesn't care about real agent reasoning.

- **B — Per-test SF state injection.** Use the SF startExecution API with a synthetic input that pre-populates `agentResults.InvokePortfolioEngine.agentOutput` and `agentResults.InvokeAdvisoryNarrative.agentOutput` so the SF skips the agent invocations entirely. Requires the SF to support an alternative entrypoint (or a Choice-skipping branch) — more invasive.

Recommend A; it's localized to test code and doesn't change production SF.

## Done definition

- Test fixture (in `libs/integration-testing`) that traps `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` on the advisory bus, captures `subject.taskToken`, and emits `PORTFOLIO_COMPLETED` / `NARRATIVE_COMPLETED` with synthetic `agentOutput` so SF resumes without invoking Bedrock.
- Both integration blockers re-enabled and passing 2 consecutive runs per [[feedback-flake-means-broken]]:
  - `decision-workflow-ctrl.integration.test.ts:534` (Test 10 — packet-shape contract).
  - DWC Tests 14 + 15 (LedgerSnapshot end-to-end SF chain), `it.skip` removed.
- Documentation in the fixture's home lib + the DWC service card.

## Out of scope (deferred)

- Mocking the real Bedrock InvokeAgentRuntime call (different layer — handled by SsmOverride / FakeLlm patterns).
- Increasing AgentCore maxVms quota in the sandbox (`agentcore-maxvms-prod-quota-increase` LATER).
- Production SF state-machine changes (the agent stub is test-side only — production SF stays unchanged).
- Re-enabling integration tests that fail for reasons unrelated to PE/AN agent timeouts (separate flake categories filed under `integration-deep-coldstart-flakes-post-trap-hardening`).
- Playwright `rebalance-trades-on-drift.spec.ts` re-enabling (filed as `playwright-rebalance-real-agents-maxvms-remediation` — the Playwright path runs real agents per [[feedback-e2e-no-external-mocks]] and needs a maxVms infrastructure fix, not a stub).

## Related

- Parent workstream: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability).
- Spun off: `playwright-rebalance-real-agents-maxvms-remediation` — Playwright path filed separately because policy requires real agents end-to-end.
- Related backlog: `agentcore-maxvms-prod-quota-increase` (LATER), shipped `agentcore-maxvms-browser-path-resilience` (idleTimeout/maxLifetime tuning), shipped `agentcore-invocation-resilience` (event-processor retryable + SQS native redrive).
- Feedback: [[feedback-mock-all-external-apis]], [[feedback-e2e-no-external-mocks]], [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]].
