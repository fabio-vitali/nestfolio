---
id: advisory-phase-ab-integration-coverage
status: parking
type: tooling
notes: "Phase A SF state + Phase B Memory emit/retrieval have unit + manual smoke coverage but no integration tests — gap surfaced post-Phase-B ship."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-coverage-backfill
epic_role: core
---

# Integration test coverage for Phase A (SF state) + Phase B (long-term Memory) advisory flows

## Evidence

Inventory taken 2026-05-14 after Phase B ship (`1e1e23d4`):

| Project | Integration files | Files exercising Phase A/B concepts |
|---|---|---|
| `decision-workflow-ctrl` | 2 | 0 |
| `investor-profile-ctrl` | 2 | 0 |
| `market-intelligence-ctrl` | 2 | 0 |
| `portfolio-engine-ctrl` | 2 | 0 |
| `advisory-narrative-ctrl` | 2 | 0 |

Grep terms checked: `searchLongTermMemory`, `emitLongTermEvent`, `agentResults`, `priorNarratives`, `wrapAgentOutput`, `SendTaskSuccess` payload shape. None match any integration test in `services/advisory/*/test/integration/`.

Phase A's SF state inter-agent handoff and Phase B's emit-after-validation are covered by unit tests + a manual `CreateEvent → 60s wait → RetrieveMemoryRecords` smoke test against deployed dev (in the Phase B ship narrative). Integration tests still mock AgentCore Memory entirely, so a regression in the wrapped payload shape, the `agentResults.<Upstream>.agentOutput` Parameters plumbing, or `emitLongTermEvent`'s call shape would not be caught at the integration layer.

## Hypothesis

Cheapest next step: add ONE integration scenario per affected service:

- `advisory-narrative-ctrl/test/integration/long-term-recall.integration.test.ts` — asserts that `emitLongTermEvent` is invoked exactly once with `{ namespace: 'rationale', payload: <explainability> }` after a happy-path `runPipeline`, and zero times on a degraded one. Mock `bedrock-agentcore` SDK at the boundary (matches the existing integration test mocking style for AgentCore).
- Optional: parallel scenarios for the other 3 ctrls (`investor-profile`, `market-intelligence`, `portfolio-engine`) using the same mock pattern.
- For Phase A coverage: assert that `SendTaskSuccess` body includes the wrapped agent output (not metadata-only) in the existing Lambda-level integration scenarios.

## When to promote

If a regression in the SF state shape or the Memory emit path slips through unit tests and is caught only by manual e2e — that's the trigger to promote this from parking to active.

## Related

- [[inter-agent-state-handoff-sf-vs-memory]] (shipped 2026-05-14) — the workstream that introduced these surfaces without integration coverage.
