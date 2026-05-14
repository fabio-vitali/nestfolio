---
id: advisory-narrative-agentcore-latency-residual
status: parking
type: bug
notes: "Phase A removed 28s Memory retry; narrative AgentCore orchestrator still ~22-28s (above 20s test budget assuming 15s baseline)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-narrative AgentCore residual latency — uncovered by Phase A

Surfaced 2026-05-14 during Phase A validation gate (commit-range `f0fbf2d3..0cec306f` on `feat/inter-agent-sf-state-phase-a`).

## Evidence

Phase A successfully removed the 28s Memory retry sleep (verified by `git diff` on `advisory-narrative-ctrl/src/handlers/event-listener.ts` and by absence of `writeAgentOutput`/`BatchCreate` in AgentRuntime CloudWatch logs after dev deploy).

After deploy, e2e validation gate (`first-decision.e2e.test.ts` line 113) asserts `narrative['gen_ai.invocation.latency_ms'] < 20_000`. Observed:

| Run | Lambda condition | gen_ai.invocation.latency_ms | Lambda Duration |
|---|---|---|---|
| 1 (cold AgentCore) | Cold | 28109 ms | 29570 ms |
| 1 (cold AgentCore) | Cold | 25852 ms | 27601 ms |
| 2 (warm AgentCore) | Cold Lambda, warm container | 22961 ms | (similar) |

`gen_ai.invocation.latency_ms` equals the **orchestrator's** `Orchestrator invocation completed.duration` (single LLM call, Sonnet, structured-output validated). No retry sleep. No Memory I/O.

## Why this is a regression worth filing

`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts:40-43` budget comment states:

> Narrative is a single Sonnet invocation behind a Lambda Ingress — cold starts + Bedrock jitter push p95 close to 15s. Budget holds 20s headroom to catch pathological regressions without flaking on normal variance.

The budget assumed ~15s baseline. Today's baseline is 22-28s. The ~7-13s overhead sat hidden behind the 28s Memory retry until Phase A removed the retry. The math:

- Pre-Phase-A p95 ~56s = 28s retry + 28s narrative orchestrator.
- Spec target was <22s, which implied a ~15-20s narrative orchestrator.
- Reality is ~22-28s narrative orchestrator. Phase A's structural fix landed cleanly but the gate threshold was based on an outdated baseline.

## Hypotheses for the 7-13s overhead

1. **AgentRuntime container cold start** — orchestrator duration is reported by the agent process inside the container; if the container's first request blocks on model warm-up the orchestrator clock starts before model availability.
2. **Larger prompt** — Phase A inlines investorProfile/marketAnalysis/portfolio into the event subject. If the AgentRuntime now receives a bigger structured input, Sonnet prefill latency grows. Worth measuring `gen_ai.usage.input_tokens` before/after.
3. **withFallback retry** — `agent-orchestrator/src/agent-factory.ts` wraps `createAgentNode` with `withFallback(withRetry(withValidation(...)))`. A silent fallback path (e.g., structured-output validation failure → retry) could add a full LLM call inside one orchestrator invocation. Worth checking AgentRuntime DEBUG logs for retry markers.
4. **Sonnet model latency drift** — Bedrock-side; not in our control.

## Cheapest next step

Open the narrative AgentRuntime DEBUG logs for one e2e run, grep for retry/fallback/validation markers, and check `gen_ai.usage.input_tokens`. ~15 minutes.

## Decision point

Two paths forward, both reasonable:
- **(a) Adjust the budget** to reflect today's reality (e.g., 30_000ms for narrative). Acknowledge Phase A as shipped — the 28s retry is gone, latency dropped 50%, the structural migration to SF state is clean.
- **(b) Investigate the residual** before declaring Phase A shipped. Hypotheses #1-#3 above each have cheap diagnostics.

User to decide which path is acceptable for the active workstream's ship criteria.
