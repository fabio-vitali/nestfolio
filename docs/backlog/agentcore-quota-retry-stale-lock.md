---
id: agentcore-quota-retry-stale-lock
status: active
type: bug
rank: null
notes: "Correctness gap in shipped agentcore-invocation-resilience: the eager AgentInvocation IN_PROGRESS idempotency lock (written before the agent invoke) is never released on a maxVms/throttle rejection, so the SQS redrive short-circuits as DuplicateInvocationError and never re-runs the agent — the snapshot is permanently lost despite the retry. Fix: release the lock on gate-rejection errors."
references: []
out_of_scope:
  - Releasing the lock on non-gate-rejection failures (resolveAgentRuntimeTarget SSM errors, mid-run timeouts, post-agent validation/write failures) — those cannot prove zero token spend, so re-running risks double-charge; left as pre-existing behaviour.
  - Storing the agent output in the lock row to make post-agent failures replayable without re-invoking — larger idempotency refactor, separate workstream.
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# AgentCore quota retry defeated by stale idempotency lock

**Origin:** found while answering a cost question on the shipped `agentcore-invocation-resilience` workstream (2026-05-21).

`services/advisory/investor-profile-ctrl/src/agent-service.ts` `runPipeline()` writes the `AgentInvocation` idempotency-lock row (`sk = INV#{eventId}`, `status: IN_PROGRESS`, `ConditionExpression: attribute_not_exists(sk)`) **before** the `dispatchAgentInvocation` call. `eventId` is stable across SQS redeliveries.

When the AgentCore invoke is rejected with `ServiceQuotaExceededException` (`maxVms`):

1. Attempt 1 — lock written, invoke rejected, error propagates; `event-processor` now classifies it retryable (`agentcore-invocation-resilience` defect A) so SQS keeps the message.
2. Attempt 2 (redrive) — the lock Put fails `attribute_not_exists(sk)` because attempt 1's row is still there → `DuplicateInvocationError` → `event-listener.ts:80` returns `[]` → no snapshot, message deleted.

Net: the SQS retry is **inert** — it never re-runs the agent. The hard `maxVms` case is not actually recovered; defect A is cosmetic for it. (The slow-invoke case *is* recovered by defect B, which is why the e2e gate passed 9/9 without exercising this path.)

**Cost note:** the inert retry does NOT increase Bedrock/agent cost — a gate rejection runs zero tokens, and the short-circuit prevents any re-invocation. The defect is lost recovery, not cost.

**Fix:** in `agent-service.ts`, catch gate-rejection errors (`ServiceQuotaExceededException`, `ThrottlingException`) around `dispatchAgentInvocation` and `DeleteCommand` the `INV#{eventId}` lock row before rethrowing. Cost-safe — a gate rejection provably ran zero execution, so the redrive's re-run is the only run. Regression tests in `test/unit/agent-service.test.ts`.
