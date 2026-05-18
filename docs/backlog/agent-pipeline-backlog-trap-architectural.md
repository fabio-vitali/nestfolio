---
id: agent-pipeline-backlog-trap-architectural
status: active
type: design
rank: null
notes: "Architectural fix for SF→EB→SQS→Lambda→AgentCore→SendTaskSuccess hop. Adopted ACTIVE 2026-05-18 same-day-after-unpark: post-precomputation e2e run on deployed dev produced PE-only trap evidence (PE IngressQueue 810 visible + 4 in-flight while IP/MI/AN/DWC IngressQueues all 0). PE handler is healthy (178 unique decisions drained cleanly in 15min ≈ 0.2 msg/s — matches the dossier's predicted 0.33 msg/s ceiling); the structural three-knob mismatch is the bottleneck. Precomputation dissolved IP/MI surface but concentrated demand on PE. Dev PE IngressQueue purged at adoption to clear stale task-token-dead messages — does not address structural cause."
references:
  - libs/event-processor/src/pipelines/resume-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - services/advisory/advisory-narrative-ctrl/src/service.stack.ts
  - libs/cdk-constructs/src/utils/lambda-profiles.ts
out_of_scope:
  - Inter-agent state handoff redesign (Phase A/B is correct as designed; this fix touches transport wiring only).
  - Long-term Memory write latency on PE/AN — file separately if it turns out to be the dominant per-cycle latency contributor.
  - Re-introducing IP/MI to the per-cycle path — precomputation shipped 2026-05-17 and stays.
  - Test-harness changes (EventBusTrap, AgentTraceTrap, fixture polling budgets).
  - Compliance-ctrl or AssemblePacket state changes.
  - The separate publisher-side bug tracked in `update-operating-mode-cdc-silent` (independent root cause, independent test scenario).
  - F1/F3 prevention via test gating — the architectural fix should make scenarios 11+12 deterministically green; gating heuristics are out of scope.
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

## Status: active (2026-05-18, adopted same-day-after-unpark)

Adopted ACTIVE after `do all` confirmation. Dev PE IngressQueue purged at adoption (810 → 0) to clear stale task-token-dead messages — pure containment, the structural fix is the whole point of this workstream.

## Out of scope (mirrors frontmatter `out_of_scope`)

- Inter-agent state handoff redesign — Phase A/B is correct as designed; this fix touches transport wiring only.
- Long-term Memory write latency on PE/AN — file separately if it turns out to be the dominant per-cycle latency contributor.
- Re-introducing IP/MI to the per-cycle path — precomputation shipped 2026-05-17 and stays.
- Test-harness changes (EventBusTrap, AgentTraceTrap, fixture polling budgets).
- Compliance-ctrl or AssemblePacket state changes.
- The separate publisher-side bug tracked in `update-operating-mode-cdc-silent` (independent root cause, independent test scenario).
- F1/F3 prevention via test gating — the architectural fix should make scenarios 11+12 deterministically green; gating heuristics are out of scope.

## Surfacing run — 2026-05-18 (the parking-invalidator)

Parked at start of day under the rationale "precomputation dissolves the trap surface and scenario 11/12 are green on warm Lambdas." The first post-merge e2e run (2026-05-18 ~10:30 local, against deployed-dev after `14b61dc7` Phase 1 cost-reduction merge) invalidated both clauses for PE specifically. Compound trigger (a) is now met with hard evidence:

**E2e failures (this run):**
- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` — `waitForGraphQL` timeout 180s on `getDecisionHistory`.
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` — `waitForGraphQL` timeout 180s on `getDecisionHistory` inside `withLiveDecision()` in `beforeEach`.

**SF evidence** (`dev-decision-workflow-ctrl-decisionstatemachine` execution `9a440515-cae4-5f2c-39f0-8cd0146cb075_6c6d5d64-22a9-9b38-a202-1f22bc40afcf`, started `2026-05-18T08:41:26.878Z`, FAILED `2026-05-18T08:51:27.163Z`):
- Last event: `TaskTimedOut` at id=39 on `events:putEvents.waitForTaskToken` for `CONSTRUCT_PORTFOLIO`, `error: States.Timeout`. Then `ExecutionFailed` id=40.
- 5+ sibling executions started within 200ms at `08:41:26` all FAILED at the 10-min boundary at the same `putEvents.waitForTaskToken` state. Input subject: `{__typename: 'DriftRecord', sk: 'DriftRecord#BND'}` for tenant `e2e-1779093146977-0d55011f` — i.e. real reconciliation-driven drift fan-out, not synthetic e2e events.

**Queue evidence** (snapshot taken `2026-05-18 ~11:30 local`, after the e2e run finished):

| Service IngressQueue | Visible | Not visible (in-flight) |
|---|---|---|
| `investor-profile-ctrl` | 0 | 0 |
| `market-intelligence-ctrl` | 0 | 0 |
| **`portfolio-engine-ctrl`** | **810** | **4** |
| `advisory-narrative-ctrl` | 0 | 0 |
| `decision-workflow-ctrl` | 0 | 0 |

**PE handler is healthy** — CloudWatch Logs Insights on `/aws/lambda/dev-portfolio-engine-ctrl-IngressHandler*` 2026-05-18 08:40-08:55 UTC: 178 distinct `decisionId` values processed cleanly, AgentCore Runtime returning 16-17 KB responses (`responseBytes`), handler exiting with `success:true`. Drain rate ≈ 178/900s = **0.2 msg/s**, matching the dossier's predicted 0.33 msg/s ceiling. This is structural, not a code regression — Lever B's MemoryStrategies redesign (`944020ca`/`c2c6b3a6`) did not break PE; it just doesn't help throughput.

**Why precomputation didn't fix scenario 11+12:**
- Precomputation removes IP+MI per-cycle messages. IP/MI queues confirmed empty.
- PE+AN remain per-cycle (case-specific, non-precomputable). PE-only queue now absorbs the entire per-cycle agent demand for ALL concurrent SFs.
- Reconciliation-driven drift fan-out produces more SF executions than the e2e fixture alone would (DriftRecord per instrument × tenants).
- AN queue stays empty because the SF gates AN behind PE completion — PE bottleneck masks AN's own throughput.

**Cheapest containment** (NOT the architectural fix — just to unjam dev for follow-up e2e):
- Purge `dev-portfolio-engine-ctrl-IngressQueue26236266-pZkiWAJicW2A` to evict stale messages whose task tokens already died. **Requires user confirmation** (queue mutation; not in the dev-introspection pre-authorization list).

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
