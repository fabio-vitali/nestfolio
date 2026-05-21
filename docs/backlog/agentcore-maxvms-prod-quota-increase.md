---
id: agentcore-maxvms-prod-quota-increase
status: parking
type: infra
rank: null
notes: "Request a Bedrock AgentCore maxVms (concurrent micro-VM) Service Quotas increase for production accounts. Sandbox deliberately keeps the low quota for cost; native SQS retry (agentcore-invocation-resilience) absorbs sandbox saturation. Sandbox-side alternative: cap ESM maxConcurrency / reservedConcurrency across agent-invoking ingress handlers."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Production `maxVms` quota increase for AgentCore

**Evidence (2026-05-21, dev account 771924376645):** Bedrock AgentCore `maxVms` (account+region concurrent micro-VM quota) is saturated by the e2e suite's agent fan-out — `portfolio-engine-ctrl` IngressHandler logged `ServiceQuotaExceededException: maxVms limit exceeded` 159× in 50 min; `investor-profile-ctrl` and `advisory-narrative-ctrl` also hit it.

`agentcore-invocation-resilience` makes this non-fatal in sandbox via SQS native retry — saturation self-heals over minutes, acceptable because no agent path in sandbox has a hard real-time deadline beyond test fixtures.

**Promote when a production environment is being stood up** (user will action it just before production — no prod env exists yet).

This item covers the **production** posture, where a saturated `maxVms` would degrade real onboarding/decision latency:

1. Request a `maxVms` increase via Service Quotas for each production account, sized to peak concurrent decision + onboarding agent fan-out.
2. Sandbox-side alternative (Option D from the design spec): cap ESM `maxConcurrency` / `reservedConcurrency` on the agent-invoking ingress handlers (IP / PE / MI / AN / onboarding) so total demand stays under the account quota — reduces how often native retry has to fire and keeps the e2e suite fast.
