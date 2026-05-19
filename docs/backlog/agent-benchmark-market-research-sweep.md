---
id: agent-benchmark-market-research-sweep
status: shipped
rank: null
type: tooling
notes: "market-research swept 2026-05-20 — 4 models × 3 iterations against captured 15-min-tick prompt; Nova Pro recommended pending confirmation rerun + signal-coverage check."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  - Fixture captured from natural 15-min MARKET_SNAPSHOT_REFRESH_TICK invocation: benchmarks/fixtures/market-research.input.json (capturedAt 2026-05-19T22:29:06.198Z, 4328-char prompt, modelId us.anthropic.claude-sonnet-4-6).
  - Sweep complete: 4 models × 3 iterations = 12 calls. raw-results: benchmarks/tasks/market-research/2026-05-19T22-29-42-249Z/raw-results.json. Total sweep cost $0.389.
  - Per-task evaluation written: benchmarks/tasks/market-research/2026-05-19T22-29-42-249Z/evaluation.md.
  - Cross-task report appended (§7 postscript): benchmarks/_summary/2026-05-19T21-15-00Z/cross-task-report.md.
  - Aggregate results — Sonnet 4.6 (current): 3/3 schema, 3/3 not-degraded, median 21677ms, $0.0251/call. Opus 4.6: 3/3, median 17820ms, $0.1015/call (4.1× Sonnet cost). Nova Pro: 3/3, median 4707ms, $0.0031/call (8.2× cheaper, 4.6× faster, latency variance 49% — confirmation rerun gated). Nova Premier: 0/3 ResourceNotFoundException (matches bedrock-dev-model-access-audit shipped 2026-05-20).
  - Recommendation: change market-research.config.ts modelId from us.anthropic.claude-sonnet-4-6 to amazon.nova-pro-v1:0, gated on confirmation rerun at --iterations 5 + downstream MarketSnapshot signal-coverage check (Nova Pro produces 5 signals vs Sonnet/Opus 9; coverage narrower on TLT/GLD/EFA/EEM).
  - No code/infra changes; benchmarks/ tree is gitignored end-to-end (per agent-benchmark-skill design spec §4.2). Only committed mutation is this backlog file's status + the regenerated docs/BACKLOG.md.
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
