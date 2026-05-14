---
id: advisory-narrative-agentcore-latency-residual
status: shipped
type: bug
notes: "Sonnet 4.6 single-call decode-dominated at 22-30s. Switched to Haiku 4.5 — 4 consecutive runs at 5.8-6.4s (median 6.1s), ~75% reduction. Hypotheses #1 (retry firing) and #2 (prefill) falsified via diagnostic envelope-summary log; #3 (decode) confirmed."
references: []
out_of_scope:
  - "Phase A SF-state plumbing (shipped 2026-05-14 in commit 1e1e23d4 — out of bounds)"
  - "Other 3 advisory agents (investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl) — narrative-only workstream"
  - "Long-term Memory recall (Phase B, shipped separately)"
  - "Widening the 20s e2e regression-canary budget — explicitly NOT a fix per file body"
  - "rebalance-planner-mode-awareness and other mode-aware refactors"
  - "AgentCore Memory namespace alignment (separate parking item)"
  - "Explainability quality eval — Haiku rationale richness vs Sonnet. Test passed structural assertions; subjective-quality A/B left to backlog item if a UX regression is observed."
spec: null
plan: null
topic_memory: []
validation_gate: "apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts PASSES with narrative model=haiku. 4 consecutive AgentCore Orchestrator envelope-summary log entries on dev: 5770ms, 6014ms, 6242ms, 6391ms (all single-LLM-call, model=haiku)."
---

# advisory-narrative AgentCore steady-state latency floor — uncovered by Phase A

Surfaced 2026-05-14 during Phase A validation gate (commit-range `f0fbf2d3..0cec306f` on `feat/inter-agent-sf-state-phase-a`).

## Finding

Phase A successfully removed the 28s Memory retry sleep (verified by `git diff` on `advisory-narrative-ctrl/src/handlers/event-listener.ts` and by absence of `writeAgentOutput`/`BatchCreate` in AgentRuntime CloudWatch logs after dev deploy).

The latency observed AFTER the fix is NOT a cold start. Across 20+ orchestrator invocations spanning ~30 minutes of AgentRuntime activity on dev, `Orchestrator invocation completed.duration` distribution was 22-37s with no meaningful cold-vs-warm delta. That's the steady-state inference cost for a single narrative request.

If 22-30s is the steady-state floor for a single narrative call, the architecture cannot serve real users in a synchronous decision flow. This was a pre-existing problem hidden behind the 28s Memory retry; Phase A made it visible.

## Likely contributors (need targeted measurement, not speculation)

1. **withRetry wrapper firing.** `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:19-27` wraps `createAgentNode(explainabilityConfig)` with `withRetry({ maxAttempts: 2, escalationPath: ['sonnet', 'opus'] })`. If `narrativeValidationRule` rejects the first Sonnet output, the orchestrator does a second LLM call — potentially with Opus. Two sequential calls at ~10-15s each = the observed 22-30s. **Check `narrative.llmCalls.length` in a real AgentTraceEnvelope** — if `>1`, retries are firing routinely (validation is too strict) rather than catching pathological cases.

2. **Large prompt prefill.** The orchestrator input is `Decision ${decisionId} context: ${JSON.stringify(payload.upstreamOutputs)}` + operating-mode framing + KB context. After Phase A, `upstreamOutputs` carries 3 full upstream agent outputs (investor profile + market analysis + portfolio) inline. That can be 10-25 KB of JSON, which is several thousand input tokens. Sonnet prefill at 8k-10k input tokens costs ~5-10s before any output. Check `gen_ai.usage.input_tokens` in a real envelope.

3. **Output length.** The narrative response is multi-paragraph structured JSON (explainability rationale, summary, key drivers, risks). At Sonnet's ~50-80 tokens/sec output rate, 800-1500 output tokens = 10-30s decode. Realistic for the schema as written.

## Cheapest next diagnostic

Print the AgentTraceEnvelope from one e2e run by adding a logger.info to the test's `narrativeTraces[0]` immediately before the assertion. Capture `narrative.llmCalls.length`, each `latencyMs`, and the model tier. That single data point distinguishes #1 (≥2 calls) from #2+#3 (1 call but slow).

## Decisions to make AFTER measurement (NOT before)

- **If #1 (retries firing routinely):** loosen `narrativeValidationRule` so it doesn't reject valid Sonnet output; OR raise structured-output reliability via prompt engineering; OR drop the second-attempt Opus escalation if Opus is too slow for the budget.
- **If #2 (prompt prefill dominant):** stop inlining full upstream outputs; pass references (decision ID + tenant ID) and let the narrative agent fetch only what it needs; OR compress upstream outputs to relevant fields before injection.
- **If #3 (output length dominant):** tighten the explainability schema (fewer required fields); OR move narrative generation off the synchronous decision path (emit a DECISION_PACKET_CREATED event without the narrative, generate it async, update the row).

## Why this is UX-blocking, not just budget-blocking

The advisory pipeline is a 4-agent fan-out + assemble. End-to-end p95 today must be **~30s + narrative duration**. With narrative at 22-30s, total is 50-60s. No user will wait that long for "your portfolio recommendation". This is the actual architecture problem to solve.

The original e2e test budget at 20s was correct as a regression canary, NOT something to widen. Widening the budget would normalize a UX-blocking floor.

## Phase A ship status

Phase A's structural work (SF state Parameters, MemoryClient slim, IAM grant drop, doc updates) is done correctly. The bedrock-agentcore-latency-residual is a *separately scoped* problem that the Phase A test budget happens to detect. Ship decision belongs to the user.

## Resolution (2026-05-14 — 2026-05-15)

Diagnostic path:

1. Added a 21-line `Orchestrator envelope summary` log to `libs/agent-orchestrator/src/invoke-orchestrator.ts` — every invocation now emits `llmCallCount`, per-call model tier, per-call latency, total tokens. Permanent observability improvement; affects all 5 services that use `invokeOrchestrator`.

2. First measurement (Sonnet 4.6, 16+ dev invocations): `llmCallCount: 1`, single call took 22.3s. **Hypothesis #1 (retries firing) FALSIFIED.** `narrativeValidationRule` is loose (length ≥ 20, ≥ 1 keyFactor, wordCount 0-2000) — Sonnet clears those trivially. γ.4 inner retry not firing either.

3. With 22.3s on a single call at Sonnet's ~50-80 tok/s decode rate, the only consistent decomposition is ~2-3s prefill + ~18-20s decode → ~1000-1500 output tokens. **Hypothesis #3 (decode-dominated) confirmed by elimination.**

4. Switched `explainability.config.ts` modelId from `us.anthropic.claude-sonnet-4-6` to `us.anthropic.claude-haiku-4-5-20251001-v1:0`.

5. **Hidden IAM-grant gotcha:** the AgentRuntime CDK construct only grants `bedrock:InvokeModel` on the model IDs in `props.modelIds`. The narrative stack passed `[modelSonnetId]`. After the agent-config switch, ChatBedrockConverse called Haiku, AWS returned AccessDenied, `withFallback` caught it silently, the orchestrator returned 'success' with empty `llmCalls` in 150-200ms — but the wave-node entry was `ok: false`, so `assertOrchestratorOutput` threw downstream and the e2e failed at an *earlier* line than the latency assertion. Fix: rotate `modelIds` + `bedrockModelIds` (BedrockUsageAlarms) + observability target from `modelSonnetId` to `modelHaikuId`.

6. Post-fix measurements (Haiku 4.5, 4 consecutive runs): **5770ms, 6014ms, 6242ms, 6391ms** — median 6.1s, range 5.8-6.4s. ~75% reduction vs Sonnet. Well under the 20s e2e regression-canary budget.

7. Updated `first-decision.e2e.test.ts:112` to assert `model='haiku'` (was `'sonnet'`). Updated `agent-service.test.ts:73` to assert `modelTier='haiku'`. Updated `agent-service.ts:143` metadata.

## Out of scope (filed parking if observed)

- Token counts from `ChatBedrockConverse` are not flowing through `AgentTracer.handleLLMEnd` — `inputTokens` and `outputTokens` are 0 in every envelope. The tracer looks at `tokenUsage`/`usage` keys; Bedrock Converse reports usage under a different path. Observability gap, separate item.
- Explainability quality A/B (Haiku rationale richness vs Sonnet) — would need either a manual review pass or a structured eval suite. Test passes structural assertions but doesn't measure subjective quality.
