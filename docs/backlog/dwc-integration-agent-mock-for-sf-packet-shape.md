---
id: dwc-integration-agent-mock-for-sf-packet-shape
status: queued
rank: 4
type: tooling
notes: "Task 10 packet-shape integration test (decision-workflow-ctrl.integration.test.ts:534) needs full SF chain (PE+AN, 240s budget). Dev sandbox hits PE TaskTimedOut at 120s due to AgentCore maxVms saturation. CW evidence: execution arn fb73afaa-f6c0-4d6e-7aa4-c70d4f532072 entered InvokePortfolioEngine at 15:24:38, TaskTimedOut at 15:26:38 (exactly 120s). Currently it.skip'ped. Needs trap-based agent stub (CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE → fake _COMPLETED with synthetic agentOutput + captured taskToken) to bypass Bedrock and unblock the contract assertion. ALSO unblocks ferry-ledger-positions-to-advisory's DWC Tests 14+15 (LedgerSnapshot end-to-end SF chain, skipped at 8458e131) AND apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts — all hit the same PE-via-Bedrock path."
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

## The blocked tests

Three artifacts now block on this same agent-stub infrastructure:

1. **DWC Test 10** — `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts:534` (`decision-workflow-ctrl packet-shape contract (workstream 2026-05-25)`), `it.skip`-ped. Asserts the post-units-fix RECOMMENDATION_PROPOSED contract.
2. **DWC Tests 14 + 15** — same file, `LedgerSnapshot end-to-end SF chain` describe block, `it.skip`-ped at commit `8458e131` (ferry-ledger-positions-to-advisory workstream). Assert that LedgerSnapshot reaches AssemblePacket through a real SF execution and produces non-empty delta trades.
3. **PW scenario** — `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` (committed during ferry-ledger workstream). Asserts that a post-onboarding rebalance produces compliant trades against a known holdings snapshot.

All three hit the same `InvokePortfolioEngine` → AgentCore Bedrock path and time out under dev sandbox maxVms saturation.

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

- Test fixture (in `libs/test-support` or similar) that traps `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` and emits `_COMPLETED` events with synthetic agent outputs and the captured taskToken.
- All three blocked artifacts re-enabled and passing 2 consecutive runs per [[feedback-flake-means-broken]]:
  - `decision-workflow-ctrl.integration.test.ts:534` (Test 10 — packet-shape contract).
  - DWC Tests 14 + 15 (LedgerSnapshot end-to-end SF chain), `it.skip` removed.
  - `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` runs to completion.
- Documentation in `libs/test-support` README + the DWC service card.

## Out of scope (deferred)

- Mocking the real Bedrock InvokeAgentRuntime call (that's a different layer — handled by SsmOverride or FakeLlm patterns).
- Increasing AgentCore maxVms quota in the sandbox (that's the `agentcore-maxvms-prod-quota-increase` LATER item).

## Related

- Parent workstream: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability).
- Dependent shipped workstream: `ferry-ledger-positions-to-advisory-steady-state-decisions` — its DWC Tests 14+15 and PW `rebalance-trades-on-drift.spec.ts` are runtime-blocked on the agent stub delivered here.
- Related backlog: `agentcore-maxvms-prod-quota-increase`, shipped `agentcore-maxvms-browser-path-resilience`, `agentcore-invocation-resilience`.
- Feedback: [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]].
