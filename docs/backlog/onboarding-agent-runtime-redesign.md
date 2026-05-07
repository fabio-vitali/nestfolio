---
id: onboarding-agent-runtime-redesign
status: shipped
type: refactor
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-04-28-onboarding-runtime-redesign.md
plan: null
topic_memory:
  - project_playwright_e2e_ui.md
validation_gate: "Custom OnboardingAgent extends AbstractAgent shipped; bundle 6.8 → 6.3 MB; e2e journey passes step 2."
closed: "2026-04-28"
notes: "Replaced LangGraphAgent (remote-only) with custom OnboardingAgent driving in-process LangGraph; symmetric with 5 advisory agents."
---

# Onboarding agent runtime redesign

SHIPPED 2026-04-28 on `feat/playwright-e2e-ui`: replaced `@copilotkit/runtime/langgraph` `LangGraphAgent` (remote-only, requires `deploymentUrl` + LangSmith) with custom `OnboardingAgent extends AbstractAgent` (`@ag-ui/client`) at `services/investor/onboarding-bff/agents/onboarding/agent.ts`. Drives the existing in-process LangGraph via `streamEvents({ version: 'v2' })`; emits AG-UI events directly; tool calls extracted from `on_chat_model_end output.tool_calls` (Bedrock chunks lack id/name).

Symmetric with the 5 advisory agents (also in-process LangGraph in AgentCore). Bundle 6.8 → 6.3 MB. 8 commits HEAD `ba399082`.

Ancillary fixes shipped same day: prompts rewritten in English (Italian output preserved), inference profile `us.anthropic.claude-sonnet-4-6` as graph default, `tool_choice: 'any'` in phase-node, browser reads `event.toolCallName`, phase-node edges → `__end__` (no infinite loop).

E2E journey passes step 2; steps 3+ blocked on ID-case + phase-order + state-propagation mismatches (out of scope for Bug 4).
