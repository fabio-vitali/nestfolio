---
id: agent-runtime-structured-output-reliability
status: shipped
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agent_runtime_structured_output.md
validation_gate: "5 projects unit/lint green; integration smoke 4/4 services green; e2e gate produced non-empty proposedTrades for first time ever (CONSERVATIVE 8 trades, AGGRESSIVE 6 trades)."
closed: "2026-05-06"
notes: "Three-phase α/β/γ rollout closed silent-success failure mode where AgentCore returned empty {} agent results."
---

# Agent runtime structured-output reliability

SHIPPED-PENDING-VALIDATION 2026-05-06 on `main` (commits `137523df` α + `eff369af` β + `52a22f96` γ + `97d41a36` mid-flight + `21802d39` α-tune): three-phase architectural rollout closing silent-success failure mode where AgentCore Runtime returned empty `{}` agent results.

α — uniform `formatStructuredOutputPrompt` helper in `libs/agent-orchestrator` + 6 advisory prompts rewritten + HARD-RULES modeContext.

β — `withFallback` discriminated union `{ok:true;output}|{ok:false;reason;fallback}`; per-service `agent-service.ts` raises `DegradedAgentOutputError` instead of laundering empty fallbacks; the 2 single-agent services reshaped graph.ts to match createOrchestrator envelope.

γ — `assertOrchestratorOutput` lib helper (cross-service audit found only portfolio-engine had a guard; investor-profile, market-intelligence, advisory-narrative all silently passed `result['key']??{}`); `agent-factory.ts` retry with `tool_choice` pinned + REINFORCE_SUFFIX (Spec 3 onboarding precedent lifted from per-phase to per-agent).

E2E gate produced non-empty `proposedTrades` for first time ever (CONSERVATIVE 8 trades, AGGRESSIVE 6) — architectural fix demonstrably working. Remaining 3/3 envelope-adherence + BALANCED timeout out of scope (filed in PARKING LOT: Sonnet 4.6 mode-envelope α-tune; pre-existing AgentCore Memory namespace mismatch).
