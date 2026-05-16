---
id: agent-pipeline-backlog-trap-architectural
status: queued
type: design
rank: 3
notes: "Architectural fix for SF→EB→SQS→Lambda→AgentCore→SendTaskSuccess hop: messages process after the 600s SF task token times out; blocks e2e scenarios 11+12 green gate. Depends on observability workstream landing first."
references:
  - libs/event-processor/src/pipelines/resume-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - services/advisory/advisory-narrative-ctrl/src/service.stack.ts
  - libs/cdk-constructs/src/utils/lambda-profiles.ts
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_inter_agent_state_handoff.md
  - project_lambda_profile_system.md
validation_gate: null
---

# Agent-pipeline backlog trap (architectural)

## Context

The agent-invocation pipeline is built as: SF task `events:putEvents.waitForTaskToken` → EventBridge rule → SQS queue (vis 1800s) → Lambda (concurrency 5, batchSize 1) → Bedrock AgentCore (5–30s per call) → `SendTaskSuccess`.

Three numbers do not work together:

| Knob | Current | Implication |
|---|---|---|
| SF task `TimeoutSeconds` | 600s | After this, task token is dead |
| SQS `VisibilityTimeout` | 1800s | Failed messages re-enter queue for 30 min |
| Lambda `ESM.maxConcurrency` | 5 | Drain rate ≤ 0.33 msg/s (assuming 15s/call) |

Under load (e2e test fan-out, ~20 SF executions × 2 events = 40 messages), the queue accumulates faster than it drains. Messages reach the Lambda after their corresponding SF task token has already expired. Worse, the 1800s visibility timeout keeps stale events bouncing back for 30 minutes, prolonging the trap into subsequent test runs.

Evidence: 414 inflight on investor-profile-ctrl IngressQueue, 386 visible on market-intelligence-ctrl IngressQueue, 30 minutes after the e2e run finished.

## Blocking what

E2e gate scenarios `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (scenario 11) and `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (scenario 12). Both fail with `waitForGraphQL` timeout on `getDecisionHistory`.

## Why "queued" and not "active"

Original blocker (observability) is resolved: `agent-pipeline-task-token-timeout-observability` shipped 2026-05-16 and an e2e re-run produced the first concrete data point — `processingLagMs=1,800,450` (~30 min, 3× the 600 s SF window) on `dev-investor-profile-ctrl` IngressHandler. The trap hypothesis is now empirically confirmed, not assumed; the four design questions below can be answered with real distribution data on the next runs.

Now ranked behind `advisory-cycle-agent-precomputation` (rank 1) because that proposal dissolves the trap surface for IP+MI entirely (see § Sibling below) and may unblock e2e scenarios 11+12 alone — making this fix less urgent for the e2e gate. This work remains the durable answer for `portfolio-engine-ctrl` + `advisory-narrative-ctrl` (case-specific, cannot be precomputed) and for load growth, so it stays queued, not dropped. Promote to active when either: (a) precomputation ships and PE/AN trap behaviour is the remaining blocker, or (b) cycle load grows past current dev fan-out independent of precomputation timing.

## Design questions to resolve (in the spec phase)

1. Can the SQS hop be eliminated? SF supports `arn:aws:states:::bedrock:invokeAgent` for synchronous AgentCore invocation. Tradeoff: lose the dedup ledger in `agent-service.ts`, gain elasticity (no SQS choke point).
2. If we keep SQS, what is the right triple `(maxConcurrency, VisibilityTimeout, SF TimeoutSeconds)` for a worst-case e2e fan-out of N executions?
3. Should the agent ctrls use `lambda-profiles.agentProps` at all, or do they need a higher-concurrency variant for advisory-cycle Lambdas?
4. Bedrock TPS limits per model — what is our effective ceiling, and does that ceiling justify pre-warming + reserved concurrency?

## Related work that this design must NOT touch

- Phase A/B inter-agent state handoff is a separate workstream and is correct as designed. The architectural fix should reduce processing lag, not redesign agent state propagation.
- Long-term Memory writes (Phase B) — out of scope here. If they are the dominant latency contributor, file separately.

## Sibling: `advisory-cycle-agent-precomputation` (partial substitute)

Tracked at `docs/backlog/advisory-cycle-agent-precomputation.md` (queued, rank 1 as of 2026-05-16). That proposal moves `investor-profile-ctrl` and `market-intelligence-ctrl` out of the cycle entirely (continuous projection on change events, cycle reads snapshots).

- **For IP+MI:** the trap dissolves — there is no per-cycle invocation, so no per-cycle queue. The three-knob tension disappears for these two services.
- **For `portfolio-engine-ctrl` + `advisory-narrative-ctrl`:** the trap is unchanged. They remain case-specific and stay in the cycle.
- **Practical e2e impact:** halves the per-cycle agent message volume (40 → 20 at current e2e fan-out). May be enough to take scenarios 11+12 green even before this wiring fix ships — an empirical claim the observability data should resolve.
- **Composition if both ship:** zero per-cycle agent queueing for half the agents (precomputation), well-tuned wiring for the other half (this work). Best outcome.
- **If precomputation alone ships:** PE+AN still face the same structural trap; load growth resurfaces it. This wiring fix remains the durable answer for those two.
- **If this wiring fix alone ships:** trap is solved for all 4 agents, but precomputation's order-of-magnitude cost win on IP+MI is left on the table.

The two are independent and can ship in either order. Promote-ordering reflects expected highest near-term leverage (precomputation unblocks e2e + cuts cost), not architectural priority.
