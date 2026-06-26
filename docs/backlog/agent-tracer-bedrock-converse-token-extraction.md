---
id: agent-tracer-bedrock-converse-token-extraction
status: parking
type: bug
notes: "AgentTracer.handleLLMEnd returns 0 input/output tokens for ChatBedrockConverse — usage field path mismatch. Diagnostic envelopes lose cost/decode signal."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: agent-runtime-latent-correctness
epic_role: core
---

# AgentTracer token extraction broken for ChatBedrockConverse

Surfaced 2026-05-14 while diagnosing `advisory-narrative-agentcore-latency-residual`.

## Evidence

`libs/agent-orchestrator/src/agent-tracer.ts handleLLMEnd` extracts token usage from `output.llmOutput.tokenUsage` or `output.llmOutput.usage`:

```typescript
const rawUsage =
  (output.llmOutput as { tokenUsage?: Record<string, number>; usage?: Record<string, number> } | undefined);
const usage = rawUsage?.tokenUsage ?? rawUsage?.usage ?? {};
// ...
'gen_ai.usage.input_tokens': Number(usage.input_tokens ?? usage.promptTokens ?? 0),
'gen_ai.usage.output_tokens': Number(usage.output_tokens ?? usage.completionTokens ?? 0),
```

Every envelope captured during the narrative-latency investigation (both Sonnet and Haiku, ~24 invocations on dev) reported `inputTokens: 0, outputTokens: 0`. ChatBedrockConverse's `LLMResult` reports usage under a different field path than the tracer probes.

## Why parking, not queued

- Latency floor was diagnosed without token data (single-call duration + Sonnet decode-rate envelope sufficed).
- No e2e test currently asserts on token counts — suite is green today.
- BedrockUsageAlarms uses CloudWatch metrics published by Bedrock itself, not the tracer envelope — cost monitoring is unaffected.

## Cheapest next step (when promoted)

1. Run `pnpm nx test agent-orchestrator -t handleLLMEnd` and add a fixture LLMResult matching the actual Converse response shape (capture via a real run + logger.info).
2. Add the correct usage key (likely `output.llmOutput.usage_metadata` or similar) to the tracer probe path.
3. Backfill unit test asserting non-zero tokens for the Converse response shape.

## Related

- [[advisory-narrative-agentcore-latency-residual]] (shipped 2026-05-14) — the diagnostic that surfaced this.
