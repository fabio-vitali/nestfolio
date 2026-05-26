---
id: dwc-integration-agent-mock-for-sf-packet-shape
status: shipped
rank: null
type: tooling
notes: "Shipped 2026-05-26 as test deletion (no stub built). Brainstorming surfaced that Test 10 + Tests 14+15 were misframed: the RECOMMENDATION_PROPOSED contract (portfolioValueCents, isInitialBuild, riskCategory, proposedTrades, currentPositions) is already fully covered by assemble-packet.test.ts (unit) + decision-state-machine.test.ts (CDK). The unique 'but with REAL agents' assertion belongs to the e2e layer; carried to playwright-rebalance-real-agents-maxvms-remediation. Stub was strictly less valuable than the existing unit + CDK suite — deletion preserves all real signal."
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
validation_gate: "Test deletion shipped on `worktree-dwc-agent-mock-sf-packet-shape`. Three skipped tests removed from services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts (429 lines): Test 10 (packet-shape contract describe block) and Tests 14+15 (LedgerSnapshot end-to-end SF chain describe block). Remaining contract coverage: test/unit/assemble-packet.test.ts asserts portfolioValueCents=100_000+350_000, isInitialBuild=true/false, riskCategory=MODERATE/AGGRESSIVE, proposedTrades[0].quantityOrAmountCents=14_000, currentPositions={empty,non-empty}; test/unit/decision-state-machine.test.ts asserts WaitForCompliance subject carries portfolioValueCents/isInitialBuild/riskCategory (not legacy portfolioValue/riskScore) + MergeProjections/SetInvestorProfile/HoistMandateFromTrigger forward ledgerSnapshot through. nx affected -t lint,test green (decision-workflow-ctrl only). Real-agent end-to-end behavior handed to playwright-rebalance-real-agents-maxvms-remediation."
---

# Shipped 2026-05-26 — closed as misframed (deletion, no stub built)

## Original framing

Originally adopted as "build a trap-based agent stub for the 3 blocked artifacts (DWC Test 10, Tests 14+15, Playwright rebalance-trades-on-drift) that intermittently fail under AgentCore maxVms saturation." The stub would have lived in `libs/integration-testing`, captured `subject.taskToken` from CONSTRUCT_PORTFOLIO / GENERATE_NARRATIVE events, and published synthetic PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED events so the SF resumed without calling Bedrock.

## What changed during brainstorming

Two consecutive realizations:

**1. Integration vs e2e split.** [[feedback-mock-all-external-apis]] mandates mocking external APIs/LLMs in integration tests; [[feedback-e2e-no-external-mocks]] forbids it in e2e. The original dossier proposed one mechanism for both lanes. After clarification, Playwright `rebalance-trades-on-drift.spec.ts` was spun off as `playwright-rebalance-real-agents-maxvms-remediation` — a separate workstream where real agents run end-to-end and the maxVms saturation has to be solved at the infrastructure layer.

**2. Contract coverage redundancy.** After verifying what the surviving Jest integration tests actually assert, every claim turned out to already be covered by faster tests:

- `test/unit/assemble-packet.test.ts` (unit) directly tests `createAssemblePacketHandler` with synthetic agent outputs:
  - `result.portfolioValueCents` (100_000 deposit-only; 350_000 with positions)
  - `result.isInitialBuild` (true/false based on `currentPositions.length === 0`)
  - `result.riskCategory` (MODERATE / AGGRESSIVE propagated from investorProfile.riskCategory)
  - `result.proposedTrades[0].quantityOrAmountCents === 14_000` (canonical-cents math)
  - `result.currentPositions` (empty + non-empty paths)
- `test/unit/decision-state-machine.test.ts` (CDK) asserts the SF state JSON:
  - `AssembleDecisionPacket payload reads triggerAmountCents from $.triggerAmountCentsContainer.value`
  - `AssembleDecisionPacket ResultSelector projects portfolioValueCents + isInitialBuild + riskCategory`
  - `WaitForCompliance subject carries portfolioValueCents, isInitialBuild, riskCategory (not portfolioValue/riskScore)` — exactly the post-units-fix contract
  - `MergeProjections lifts $.parallelResults[2].ledgerSnapshot.state to $.ledgerSnapshot`
  - `SetInvestorProfile + HoistMandateFromTrigger forwards ledgerSnapshot through`
  - `ParallelProjections includes a LookupLedgerSnapshot branch with Choice on isPresent` (Tests 14+15's SF-wiring assertions)

The integration tests' unique incremental value was "the same assertions, but with REAL PE+AN agents producing REAL allocations." That's e2e behavior — not integration behavior. Their home was wrong. The right home (Playwright with real agents) is already filed separately.

## What shipped

Deleted three skipped tests (429 lines) from `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`:

1. `describe('decision-workflow-ctrl packet-shape contract (workstream 2026-05-25)')` containing Test 10 (`DEPOSIT_DETECTED → RECOMMENDATION_PROPOSED carries portfolioValueCents + isInitialBuild + riskCategory`).
2. `describe('SF reads ledgerSnapshot into AssemblePacket payload')` containing Test 14 (`SF threads ledgerSnapshot into AssemblePacket — RECOMMENDATION_PROPOSED carries currentPositions`) and Test 15 (`SF tolerates absent LedgerSnapshot — RECOMMENDATION_PROPOSED reflects initial-build state`).

The `describe('LedgerSnapshot projection')` block stays — its two non-skipped tests assert the SnapshotProjectorIngress materializes the LedgerSnapshot row, which IS unique integration coverage (the projector handler exercises real DDB writes via CDC).

No fixture was built. No `libs/integration-testing` additions. No production change.

## Why this is the right outcome

- **Contract assertions preserved.** Unit + CDK coverage is strictly equivalent to what the deleted tests asserted, runs in <5 seconds, has no flake surface.
- **Real-agent behavior moved to the right layer.** `playwright-rebalance-real-agents-maxvms-remediation` now owns the "does the full chain work against deployed agents" question.
- **Cost-positive on dev.** Each of the deleted tests, if it had been re-enabled with a stub, still would have triggered up to 4 concurrent Bedrock micro-VMs (PE + AN per SF, two concurrent SF executions per test from MANDATE_SNAPSHOT_CREATED orphan + DEPOSIT_DETECTED). The stub design avoided that, but deletion makes it permanent.
- **No regression risk.** Tests were `it.skip`'d before deletion — they produced no signal in either direction. Skipped tests are dead code masquerading as coverage.

## Out of scope (deferred, unchanged)

- Mocking the real Bedrock InvokeAgentRuntime call (different layer — handled by SsmOverride / FakeLlm patterns).
- Increasing AgentCore maxVms quota in the sandbox (`agentcore-maxvms-prod-quota-increase` LATER).
- Production SF state-machine changes.
- Playwright `rebalance-trades-on-drift.spec.ts` re-enabling — filed as `playwright-rebalance-real-agents-maxvms-remediation`.

## Related

- Spun off: `playwright-rebalance-real-agents-maxvms-remediation` — owns the e2e real-agent path now.
- Parent: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability) — Task 10 contract this workstream was trying to validate is now validated at unit + CDK layers.
- Related backlog: `agentcore-maxvms-prod-quota-increase` (LATER), shipped `agentcore-maxvms-browser-path-resilience`, shipped `agentcore-invocation-resilience`.
- Feedback: [[feedback-mock-all-external-apis]], [[feedback-e2e-no-external-mocks]], [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]].
