---
id: agentcore-invocation-resilience
status: active
type: spec
rank: null
notes: "AgentCore InvokeAgentRuntime resilience: (A) reclassify ServiceQuotaExceededException/ThrottlingException as retryable in event-processor so SQS native redrive recovers maxVms hits; (B) tune IP-ctrl ingress (Lambda 300s→150s, SQS visibility 1800s→240s) + widen onboarded() fixture budget 60s→360s. Folds in the ledger-bff quantity Int!→Float! schema fix. Root-caused from 2026-05-21 e2e feature-suite failures."
references:
  - docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
  - libs/event-processor/src/internal/errors.ts
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
  - services/ledger/ledger-bff/src/schema.graphql
out_of_scope:
  - In-handler retry inside invoke-agentcore.ts — rejected; native redrive (B) makes its only edge moot, adds code, hides latency, capped at one Lambda duration.
  - Production maxVms Service Quotas increase — tracked as agentcore-maxvms-prod-quota-increase (QUEUED).
  - Decoupling onboarded() from synchronous AgentCore-driven materialisation — tracked as e2e-fixture-agentcore-synchronous-coupling (QUEUED).
  - PE/AN backlog-trap tuning — tracked as agent-pipeline-backlog-trap-impl (shipped).
  - Concurrency caps across agent ingress handlers (Option D) — folded into agentcore-maxvms-prod-quota-increase.
spec: docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
plan: docs/superpowers/plans/2026-05-21-agentcore-invocation-resilience.md
topic_memory: []
validation_gate: null
---

# AgentCore invocation resilience

Root cause + options analysis in the design spec (§1–§5). Decision **A + B** approved 2026-05-21.

**Done-definition:** event-processor `isRetryable()` treats quota/throttle exceptions as retryable; IP-ctrl ingress runs Lambda 150s / SQS visibility 240s; `onboarded()` snapshot poll budget 360s; ledger-bff `quantity` fields are `Float!`; `accept-decision` + `request-closure` + `update-goal` e2e tests 3/3 green on deployed dev.
