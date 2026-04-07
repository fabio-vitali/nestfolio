# Prompt: Integration Test Full Coverage — Execution Plan

Paste everything below the line into a fresh conversation.

---

Use `superpowers:writing-plans` to produce an execution plan from the approved design spec at `docs/superpowers/specs/2026-04-07-integration-test-full-coverage-design.md`. Read the spec first — it contains all strategy decisions, phase structure, per-service test designs, and isolation guarantees.

The gold standard integration test is `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` with its mock handler at `libs/integration-testing/src/mock-handlers/mock-alpaca.ts`. Read both to understand the pattern every test must follow.

Key decisions already made (do NOT re-ask):
- One mock Lambda per adapter, deployed/destroyed per suite via MockApiFixture
- Mock handlers live in `services/{domain}/{service}/test/mocks/`, NOT in libs/integration-testing
- Full SF execution end-to-end (assertions on DDB state + CDC events, not SF internals)
- Mock agent responses via MockApiFixture (no real Bedrock/LLM calls)
- Full AppSync calls via existing AppSyncClient + CognitoFixture for ALL BFFs
- Happy path + key error paths (~2-3 tests per handler)
- DDB cleanup: TableAssertions tracks observed items and deletes in afterAll
- ledger-ctrl incorporated (supersedes standalone plan)
- onboarding-bff deferred (agent-based, different pattern)
- Branch: `feat/all-services-integration-tests`

The output plan must be executable by `superpowers:subagent-driven-development` — each task must be independently assignable to a subagent with enough context to execute without asking questions. Write the plan to `docs/superpowers/plans/2026-04-07-integration-test-full-coverage.md`.
