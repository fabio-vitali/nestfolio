---
id: dwc-integration-agent-mock-for-sf-packet-shape
status: queued
rank: 4
type: tooling
notes: "Task 10 packet-shape integration test (decision-workflow-ctrl.integration.test.ts:534) needs full SF chain (PE+AN, 240s budget). Dev sandbox hits PE TaskTimedOut at 120s due to AgentCore maxVms saturation. CW evidence: execution arn fb73afaa-f6c0-4d6e-7aa4-c70d4f532072 entered InvokePortfolioEngine at 15:24:38, TaskTimedOut at 15:26:38 (exactly 120s). Currently it.skip'ped. Needs trap-based agent stub (CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE → fake _COMPLETED with synthetic agentOutput + captured taskToken) to bypass Bedrock and unblock the contract assertion."
references:
  - path: services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
    anchor: L534
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: docs/superpowers/specs/2026-05-25-decision-pipeline-units-calibration-suitability-design.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Test-side agent mock for SF→RECOMMENDATION_PROPOSED integration coverage

## Why this is queued (not parking)

Per [[feedback-e2e-gaps-queued-not-parking]]: this is an integration-suite coverage gap. The test exists, is correct, and would catch real contract regressions in the SF→AssemblePacket→Compliance handoff — it's just structurally blocked by the dev sandbox's AgentCore maxVms quota intermittently timing out PortfolioEngine. The gap is the test infrastructure, not the test design.

## The blocked test

`services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts` at line 534, `decision-workflow-ctrl packet-shape contract (workstream 2026-05-25)` describe block, currently `it.skip`-ped. The test seeds MandateSnapshot + InvestorProfileSnapshot via the natural event-publishing path, emits DEPOSIT_DETECTED with amountCents=100_000, then waits for RECOMMENDATION_PROPOSED to assert:

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

- Test fixture (in `libs/test-support` or similar) that traps `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` and emits `_COMPLETED` events with synthetic agent outputs and the captured taskToken.
- The skipped test at `decision-workflow-ctrl.integration.test.ts:534` re-enabled (replace `it.skip` with `it`) and passing 2 consecutive runs against deployed dev per [[feedback-flake-means-broken]].
- The fixture is reusable — at least one other integration test in DWC adopts it as a regression guard (e.g., a steady-state decision flow test in the future).
- Documentation in `libs/test-support` README + the DWC service card.

## Out of scope (deferred)

- Mocking the real Bedrock InvokeAgentRuntime call (that's a different layer — handled by SsmOverride or FakeLlm patterns).
- Increasing AgentCore maxVms quota in the sandbox (that's the `agentcore-maxvms-prod-quota-increase` LATER item).

## Related

- Parent workstream: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability).
- Related backlog: `agentcore-maxvms-prod-quota-increase`, shipped `agentcore-maxvms-browser-path-resilience`, `agentcore-invocation-resilience`.
- Feedback: [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]].
