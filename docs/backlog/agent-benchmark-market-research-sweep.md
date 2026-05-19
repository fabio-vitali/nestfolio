---
id: agent-benchmark-market-research-sweep
status: queued
rank: 10
type: tooling
notes: "market-research not swept at agent-benchmark-skill ship — IP+MI now continuous projection, e2e doesn't fire MI."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# agent-benchmark — market-research sweep gap

Surfaced 2026-05-19 during `agent-benchmark-skill` ship. The full sweep covered 5 of 6 advisory agents — `market-research` (market-intelligence-ctrl) could not be captured because IP+MI moved to continuous projection in `advisory-cycle-agent-precomputation-impl` (shipped 2026-05-17). The standard `first-decision` e2e no longer fires MI inside the decision cycle, so the Bedrock invocation log group has no `"market research analyst"` entries within the capture window.

## Cheapest next step

1. Identify what event triggers the MI continuous-projection compute path in `services/advisory/market-intelligence-ctrl/` (likely a CDC event on some upstream snapshot).
2. Trigger it on dev (probably by emitting one synthetic CDC event via `aws events put-events` or by mutating the upstream DDB row that drives it).
3. Verify a `"market research analyst"` invocation lands in `/aws/bedrock/dev-invocations`.
4. Re-run: `AWS_PROFILE=nestfolio-dev node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/capture-fixture.ts --task market-research`
5. Re-run: `AWS_PROFILE=nestfolio-dev node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/run.ts --task market-research --iterations 3`
6. Write the per-task `evaluation.md`, append a "market-research postscript" section to the existing `cross-task-report.md`.

Promoted 2026-05-20: user opted to complete 6/6 benchmark coverage as the next-up tooling slot.

## References

- The 5-agent sweep evidence is captured in the `agent-benchmark-skill` workstream's `validation_gate:`.
- MI continuous projection: see `services/advisory/market-intelligence-ctrl/` + memory `project_advisory_pipeline_consolidation.md`.
