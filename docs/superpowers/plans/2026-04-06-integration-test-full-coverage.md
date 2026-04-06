# Integration Test Full Coverage — Gap Analysis & Plan

## Goal

Bring ALL service integration tests up to the broker-alpaca-adpt gold standard: every service test must verify the service's behaviour end-to-end, covering all handler paths, workflows, mutations, and external API interactions with proper mocks.

## Context

Phase 1 (`docs/superpowers/plans/2026-04-06-all-services-integration-tests.md`) is complete on branch `feat/all-services-integration-tests`. 28 services have integration tests, but each tests only 1 happy-path smoke test. The issue tracker is at `docs/superpowers/plans/integration-test-issues.md`.

### The gold standard: broker-alpaca-adpt

`services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` tests 4 handler paths end-to-end:
- Uses `MockApiFixture` (Lambda Function URL mock) + `SsmOverrideFixture` to redirect API calls
- Each test: put event → handler executes → DDB write verified via `TableAssertions` → CDC event verified via `EventBusTrap`
- Mock handlers in `libs/integration-testing/src/mock-handlers/mock-alpaca-api.ts`
- Mock deploy via `libs/integration-testing/project.json` build targets

### What's missing (3 gap categories)

**Category A — Third-party API adapters without mocks (5 services):**
alpha-vantage-adpt, fred-adpt, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt — all hit real APIs with soft-pass on timeout. Need MockApiFixture + SsmOverrideFixture per adapter, matching broker-alpaca-adpt pattern.

**Category B — Multi-handler CTRL/BFF services with single-path tests (6 services):**
- advisory-ctrl: 15 event subscriptions across 3 handler groups (trigger→agent, compliance callback, user response) — only 1 tested
- execution-ctrl: 5 events + scheduled Lambda (staged-order-processor) — only DECISION_APPROVED tested
- compliance-ctrl: 5 events — only DECISION_PACKET_CREATED tested
- broker-sim-adpt: 3 event types — only SIM_ORDER_REQUESTED tested
- advisory-bff: 5 event-listener paths + 2 AppSync mutations (confirmDecision/rejectDecision) — only 1 event materialization tested
- ledger-ctrl: full CDC chain untested (plan exists at `docs/superpowers/plans/2026-04-06-ledger-ctrl-full-cdc-test.md`)

**Category C — Orchestration/workflow services with only trigger tests (3 services):**
- broker-ctrl: 4 Ingress handlers + OrderStateMachine + HealStateMachine — only EXECUTION_MODE_CHANGED DDB write tested
- decision-workflow-ctrl: Step Functions workflow — only TriggerIngress DDB write tested
- advisory-ctrl (overlaps Category B): LangGraph agent invocation path untested

## Instructions

1. **Re-analyze** each service listed above by reading its CLAUDE.md, handler code, and existing integration test
2. **For each service**, determine what end-to-end paths need testing
3. **Ask the user** (via AskUserQuestion widget) about strategy decisions — e.g.:
   - Should LangGraph agent paths be tested with real Bedrock calls or mocked?
   - Should Step Functions be tested via actual SF execution or just the trigger+callback paths?
   - For data-feed adapters, should we create per-API mock Lambdas or a generic mock?
   - How to handle advisory-bff mutations that need pre-seeded DecisionReadModel state?
4. **Write a batched execution plan** with concrete per-service task specs, mock handler designs, and test scaffolding
5. The plan should be executable by `superpowers:subagent-driven-development`

## Constraints

- Continue on branch `feat/all-services-integration-tests`
- Existing tests must keep passing — add test cases, don't replace
- Mock handlers go in `libs/integration-testing/src/mock-handlers/`
- Follow broker-alpaca-adpt patterns for MockApiFixture + SsmOverrideFixture
- All handler paths per service must have at least one integration test
- Each test must verify observable side-effects (DDB write and/or CDC event), not just "Lambda didn't crash"
