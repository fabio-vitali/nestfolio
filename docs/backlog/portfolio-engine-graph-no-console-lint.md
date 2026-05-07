---
id: portfolio-engine-graph-no-console-lint
status: parking
type: bug
notes: "Trivial — eslint-disable above the operatingMode-narrowing console.warn."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:118` no-console lint error

Pre-existing `console.warn` at `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:118` violates the `no-console` rule. Introduced in commit `50835cd2 fix(portfolio-engine): warn when operatingMode narrows silently to BALANCED` (the warn is the right behavior — it's an observability hook for an unexpected operatingMode value before BALANCED narrowing).

Trivial fix: add `// eslint-disable-next-line no-console` above the call (matches the test-infra precedent in `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:178` and the recent fix to `apps/nestfolio-e2e/playwright.config.ts:31`). Surfaced 2026-05-07 during `pnpm nx affected -t lint` validation of the publish-decision-update-omits-null-fields workstream — out of scope for that workstream.
