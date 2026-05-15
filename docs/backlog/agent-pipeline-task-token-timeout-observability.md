---
id: agent-pipeline-task-token-timeout-observability
status: queued
type: spec
rank: 2
notes: "e2e scenarios 11+12 fail silently — resumeStateMachine swallows TaskTimedOut as INFO. Split swallow path: TaskDoesNotExist→INFO, TaskTimedOut/InvalidToken→ERROR + processingLagMs."
references:
  - libs/event-processor/src/pipelines/resume-state-machine.ts
  - libs/event-processor/test/pipelines/resume-state-machine.test.ts
  - docs/superpowers/specs/2026-05-15-agent-pipeline-task-token-timeout-observability-design.md
out_of_scope:
  - "Queue purge / one-shot remediation"
  - "VisibilityTimeout, concurrency, SF TimeoutSeconds tuning"
  - "Moving agent invocation off SQS→Lambda→AgentCore hop"
  - "Phase A/B Memory-write latency reduction"
  - "Changing skip() to retry (behaviour change requires new-log evidence first)"
spec: docs/superpowers/specs/2026-05-15-agent-pipeline-task-token-timeout-observability-design.md
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_inter_agent_state_handoff.md
validation_gate: null
---

# Agent-pipeline TaskTimedOut observability

## Context

The 2026-05-15 e2e run produced two failures:

- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (scenario 11) — `waitForGraphQL` 180s timeout on `getDecisionHistory`
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (scenario 12) — 240s timeout, same shape

Trace through SF `dev-decision-workflow-ctrl-decisionstatemachine`: every execution times out at 600s inside `ParallelProfiling` (`InvokeInvestorProfile` + `InvokeMarketIntelligence` both `TaskTimedOut`).

Lambda logs (last 30 min): 40/40 `"SF task already resolved, treating duplicate as success"` lines on investor-profile-ctrl Ingress with `sfnErrorName: TaskTimedOut`; same on market-intelligence-ctrl.

Queue depth at investigation time:

- `dev-investor-profile-ctrl-IngressQueue`: 0 visible, **414 inflight**
- `dev-market-intelligence-ctrl-IngressQueue`: **386 visible**, 5 inflight
- VisibilityTimeout 1800s, Lambda maxConc 5, batchSize 1

The system is in a backlog-trap pathology where messages process after their SF task token has timed out, and the swallow path at `libs/event-processor/src/pipelines/resume-state-machine.ts:47–61` masks 100% of failures as `INFO`-level duplicate logs.

## This workstream

Single-file change to make the failure mode observable. No behaviour change — only log level and added context. See linked spec for full design + validation gate.

## Why "queued" and not "active"

The architectural follow-up (`agent-pipeline-backlog-trap-architectural`) is queued at rank 2 and blocks the e2e green gate. This observability workstream is queued at rank 1 because it is a prerequisite for the architectural work — we need the new ERROR logs to confirm the hypothesis before redesigning the pipeline.

When promoted to active, change `status` to `active` and ensure `out_of_scope:` reflects the design's non-goals (already pre-filled).
