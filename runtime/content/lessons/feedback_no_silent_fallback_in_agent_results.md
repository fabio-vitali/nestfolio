---
name: No silent fallback on empty agent responses
description: Never use `?? {}` fallbacks on AgentCore/LLM response fields —
  missing output means the agent did not run; surface as an error so SF retries
  instead of silently succeeding
type: feedback
mints:
  - check: no-agent-result-fallback
    ratified: 2026-07-01T16:17:05.232Z
    status: active
---
Do not swallow empty/missing fields in agent orchestrator responses with `?? {}` or `?? []`. Missing output keys mean the agent did not execute (AgentCore can return a degraded 200 without running the container); throw a typed error so SF retries. (In-repo ring-2 mirror.)
