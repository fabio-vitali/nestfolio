---
id: agent-contract-tests
status: shipped
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agent_contract_tests.md
validation_gate: "6 agents emit AgentTraceEnvelope per invocation; 4 advisory scenarios assert process metadata (status, errors, tools, models, latency); onboarding deferral resolved via AgentCore-aligned server smoke PASSED."
closed: "2026-04-21"
notes: "Agent contract tests + AgentCore-aligned onboarding server; smoke surfaced + fixed 3 latent runtime bugs."
---

# Agent contract tests

SHIPPED 2026-04-21: 6 agents emit AgentTraceEnvelope per invocation; 4 advisory scenarios assert process metadata (status, errors, tools, models, latency).

Onboarding deferral RESOLVED 2026-04-22 without a new e2e (structural mismatch: no user-story anchor) — resolution shipped AgentCore-aligned server (`POST /invocations`, `x-amzn-bedrock-agentcore-runtime-session-id`) + SSM runtime ARN export + one-shot log smoke PASSED.

Smoke also surfaced and fixed three latent onboarding runtime bugs (CopilotKit CJS bundling, broken Hono bootstrap, deprecated LangGraphAgent import). Also fixed latent market-intelligence + advisory-narrative Ingress Lambda timeout bug (missing `profile: agentProps`).
