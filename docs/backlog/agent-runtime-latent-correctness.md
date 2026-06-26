---
id: agent-runtime-latent-correctness
status: parking
type: epic
notes: "Agent-runtime non-happy-path behaviors (token instrumentation, structured-output retry, serviceUnavailable handling) are unverified — no assertion exercises the degraded/instrumentation paths, so latent correctness gaps persist. Same 'no-assertion' debt-class as integration-coverage-backfill. Theme epic, 3 members."
done_when: "Each member's degraded/instrumentation path gains an assertion (unit or e2e) that would catch its gap, the underlying correctness bug is fixed (or the divergence documented as intentional), and all members are shipped or dropped."
scope: "Latent correctness gaps in the agent runtime that persist because nothing asserts on the affected non-happy path — wrong-but-tolerated instrumentation, retry, or degraded-result handling in libs/agent-orchestrator and the advisory agent graphs."
out_of_scope:
  - "Agent INPUT-row / event-subject selection bugs (ip-ctrl-snapshot-agent-fed-trigger-row — feeding the agent the wrong source row is a producer event-wiring cause, not an unverified degraded path)."
  - "Mode-awareness feature gaps (rebalance-planner-mode-awareness — a missing behavior, not an unasserted existing one)."
  - "AgentCore cost/latency tuning — covered by its own workstreams."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Agent-runtime latent correctness

Root cause (debt class): the agent runtime's non-happy-path behaviors are unverified. No unit test
or e2e assertion exercises the tracer's token-usage extraction, the structured-output pinned-retry
prompt composition, or the advisory agent graphs' `serviceUnavailable` handling — so each carries a
latent correctness gap that the happy path (or a tolerant downstream) masks today. Honest caveat:
the per-member fixes differ (correct a usage field path; separate two corrective prompt directives;
align return-vs-throw). The shared trigger is "nothing asserts on this degraded/instrumentation
path," the same debt-class as `integration-coverage-backfill`. Fix pattern: add the assertion that
would have caught the gap, then fix the underlying behavior (or document the divergence as
intentional).

Members (derived from `epic:` pointers):
- `agent-tracer-bedrock-converse-token-extraction` (`AgentTracer.handleLLMEnd` reads 0 input/output tokens for ChatBedrockConverse — usage field-path mismatch; no e2e asserts on token counts)
- `pinned-retry-prompt-interference-agent-factory` (the γ.4 pinned retry stacks two corrective directives — envelope feedback + REINFORCE_SUFFIX; only the rare combined-failure path; current test asserts current behavior)
- `portfolio-engine-service-unavailable-asymmetric-handling` (portfolio-engine graph returns the `serviceUnavailable` shape while the other 3 advisory graphs throw; the degraded-output path tolerates either today)
