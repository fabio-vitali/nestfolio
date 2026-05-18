# Agent-pipeline backlog trap — architectural fix (design spec)

**Date**: 2026-05-18
**Backlog**: `docs/backlog/agent-pipeline-backlog-trap-architectural.md`
**Type**: design (spec-only, Doc-layer per CLAUDE.md routing edge case)
**Follow-up**: implementation workstream filed separately at ship time (Complex lane)

## 1. Context

The per-cycle agent invocation hop for `portfolio-engine-ctrl` (PE) and `advisory-narrative-ctrl` (AN) takes the shape:

```
DWC StateMachine
  └─ putEvents.waitForTaskToken (TimeoutSeconds = 600s)
       │  emits CONSTRUCT_PORTFOLIO / GENERATE_NARRATIVE w/ taskToken
       ▼
   advisoryBus (EB Rule by detail-type)
       ▼
   <svc>-IngressQueue       (VisibilityTimeout = 1800s)
       ▼
   <svc>-IngressHandler     (agentProps: maxConcurrency=5, batchSize=1, timeout=300s)
       ▼
   AgentCore Runtime        (Bedrock decode: PE p50=17.6s, p90=28.8s; AN p50=6.2s, p90=29.7s)
       ▼
   materializeToTable('AgentCompletion' | 'AgentFailure')
       ▼  (DDB Stream → Egress → EB)
   PORTFOLIO_COMPLETED | _FAILED  (and NARRATIVE_*)
       ▼
   DWC CallbackIngressQueue → sfn-callback.ts
       ▼
   states:SendTaskSuccess | _Failure
```

Three numbers — set independently in three files, never checked against each other — combine to trap messages:

| Knob | Today | Code location |
|---|---|---|
| SF `TimeoutSeconds` | 600s | `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:95` (`Duration.minutes(10)` default; PE+AN inherit) |
| SQS `visibilityTimeout` | 1800s | `libs/cdk-constructs/src/core/ingress.ts:116` (auto-calc `6 × lambdaTimeout`) with `agentProps.timeout = 5min` |
| Lambda `sqsMaxConcurrency` | 5 | `libs/cdk-constructs/src/utils/lambda-profiles.ts:185` (`agentProps`) |

**Observed drain rate** (PE, last 7d, n=1326): `5 × (1/15s avg) ≈ 0.33 msg/s` — matches the dossier's predicted ceiling.

**2026-05-18 evidence**: PE IngressQueue 810 visible + 4 in-flight; SF execution `9a440515-cae4-...` last event `TaskTimedOut` at id=39 on `CONSTRUCT_PORTFOLIO`; 5+ sibling executions all FAILED at the 10-min boundary. IP/MI queues 0/0 (precomputation 2026-05-17 worked) — demand concentrated on PE.

## 2. Problem statement

EB+SQS is correct for the rest of the system because the downstream consumer has no hard real-time deadline. The agent-invocation hop is the **one** place where the downstream consumer (the SF task token) imposes a deadline. The current configuration uses the EB+SQS pattern outside its design envelope: visibility (1800s) is 3× the SF deadline (600s), so a single retry can land past the deadline; concurrency (5) × call latency (~25s) → 0.2 msg/s drain, an order of magnitude below realistic burst rates.

The bug is not the topology — it is that **no part of the system asserts the three numbers agree**. Any future knob change (cost reduction, profile rename, model swap) can re-introduce the trap silently.

## 3. Solution overview

Encode the three-knob agreement as a synth-time invariant inside a new helper:

- Add `agentProfile(inputs: AgentProfileInputs): LambdaProfile` to `libs/cdk-constructs/src/utils/lambda-profiles.ts`.
- The helper accepts three meaningful, defensible inputs (`agentLatencyP90Ms`, `expectedBurstSize`, `uxBudgetSeconds`), derives the three opaque ones, and throws at construction time if the invariant fails.
- Extend `LambdaProfile` to carry `visibilityTimeout`, and `Ingress` to read it from the profile (one extra fallback rung).
- DWC's SF declares the same `uxBudgetSeconds` per agent on the corresponding `createAgentInvocationState` call (currently both inherit the 600s default).
- Replace `agentProps` with `agentProfile({...})` at the two call sites (PE, AN). No shim.

The architecture is unchanged. The hidden assumption becomes an explicit, checked invariant.

### 3.1 Model-agnosticism (design principle)

**The helper has zero model knowledge.** It does not import from `@nestfolio/agent-orchestrator`, does not read SSM model IDs, does not branch on Opus/Sonnet/Haiku/anything-else. Its only latency input is `agentLatencyP90Ms` — a number.

This is deliberate: PE today runs Opus+Sonnet in parallel (`portfolio-construction` + `rebalance-planner`), AN runs Haiku-only with γ-retry + prompt-discipline α-retry paths that broaden its latency tail, and the team intends to benchmark and swap models freely. When that happens:

1. Re-run the CloudWatch p90 query on the affected handler (see §6 "Re-tuning over time").
2. Update the `agentLatencyP90Ms` input at the **single** call site in that service's stack.
3. `cdk synth` re-derives `(lambdaTimeout, sqsMaxConcurrency, visibilityTimeout)` automatically. The invariant re-checks at synth time.
4. If the new latency violates the invariant against the agent's `uxBudgetSeconds`, synth fails loudly with the failing inequality.

No change to the helper. No change to `LambdaProfile`. No change to `Ingress`. No change to the SF state machine unless the team also changes the UX budget (a separate, deliberate decision).

Model names that appear elsewhere in this spec (notably §6, §7, §9) are **observational context** for the current state — not assumptions baked into the design. Search the helper's source for "Opus", "Sonnet", "Haiku", or "Bedrock" — there will be zero hits. That is the test.

## 4. API

### 4.1 `LambdaProfile` extension

```ts
// libs/cdk-constructs/src/utils/lambda-profiles.ts
export interface LambdaProfile {
  lambdaProps: Partial<NodejsFunctionProps>;
  sqsBatchSize?: number;
  sqsMaxBatchingWindow?: Duration;
  sqsMaxConcurrency?: number;
  visibilityTimeout?: Duration;  // NEW — when set, overrides Ingress auto-calc
  ddbStreamBatchSize?: number;
  ddbStreamMaxBatchingWindow?: Duration;
  ddbStreamParallelizationFactor?: number;
}
```

### 4.2 `Ingress` wiring

`libs/cdk-constructs/src/core/ingress.ts:116` — add one fallback rung:

```ts
const visibilityTimeout =
    props.visibilityTimeout
 ?? profile?.visibilityTimeout                                    // NEW
 ?? Duration.seconds(6 * effectiveLambdaTimeout.toSeconds());
```

Precedence: explicit prop > profile > 6× auto-calc. Existing callers unaffected.

### 4.3 `agentProfile` helper

```ts
// libs/cdk-constructs/src/utils/lambda-profiles.ts
export interface AgentProfileInputs {
  /** P90 latency of the agent invocation, in milliseconds. Plan around the slow tail. */
  agentLatencyP90Ms: number;
  /** Max simultaneous messages the queue may hold from realistic fan-out. Size for 2× observed peak. */
  expectedBurstSize: number;
  /** Time the SF state can spend before the user perceives the decision as failed. Must match the SF's TimeoutSeconds for this agent. */
  uxBudgetSeconds: number;
  /** SQS retries allowed within the visibility window. Lower than the CDK 6× default so the invariant holds. */
  visibilityMultiplier?: number;  // default 4
  /** Bundling escape hatch — PE+AN must NOT externalize @aws-sdk/* (see existing comment on agentProps.bundling). */
  bundling?: NodejsFunctionProps['bundling'];
}

export function agentProfile(inputs: AgentProfileInputs): LambdaProfile {
  if (inputs.agentLatencyP90Ms <= 0) throw new Error('agentProfile: agentLatencyP90Ms must be > 0');
  if (inputs.expectedBurstSize <= 0) throw new Error('agentProfile: expectedBurstSize must be > 0');
  if (inputs.uxBudgetSeconds <= 0) throw new Error('agentProfile: uxBudgetSeconds must be > 0');
  const visibilityMultiplier = inputs.visibilityMultiplier ?? 4;
  if (visibilityMultiplier < 1) throw new Error('agentProfile: visibilityMultiplier must be >= 1');

  const p90Sec = inputs.agentLatencyP90Ms / 1000;
  const lambdaTimeoutSec = Math.ceil(p90Sec * 1.5) + 5;  // 1.5× p90 plus a 5s cold-start margin
  const sqsMaxConcurrency = Math.max(
    1,
    Math.ceil(inputs.expectedBurstSize * p90Sec / inputs.uxBudgetSeconds),
  );
  const visibilitySec = lambdaTimeoutSec * visibilityMultiplier;

  if (visibilitySec > inputs.uxBudgetSeconds * 2) {
    throw new Error(
      `agentProfile invariant violated: visibilityTimeoutSec=${visibilitySec} > uxBudgetSeconds×2=${inputs.uxBudgetSeconds * 2}. ` +
      `Lower visibilityMultiplier (currently ${visibilityMultiplier}) or raise uxBudgetSeconds (currently ${inputs.uxBudgetSeconds}).`,
    );
  }

  return {
    lambdaProps: {
      ...BASE_LAMBDA_PROPS,
      memorySize: 1024,
      timeout: Duration.seconds(lambdaTimeoutSec),
      bundling: inputs.bundling ?? { ...BASE_LAMBDA_PROPS.bundling, externalModules: [] },
    },
    sqsBatchSize: 1,
    sqsMaxBatchingWindow: Duration.seconds(0),
    sqsMaxConcurrency,
    visibilityTimeout: Duration.seconds(visibilitySec),
  };
}
```

**Note on bundling defaults**: the existing `agentProps` carries a long-form comment explaining why agent Lambdas must bundle `@aws-sdk/*` rather than externalize (Node 24 runtime SDK predates `BatchCreateMemoryRecordsCommand`). The helper inherits that default; the comment moves to `agentProfile` verbatim.

### 4.4 SF callsite changes (DWC)

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:120` and `:132`: pass concrete `timeout` to the two agent-invoke states. Today both inherit the 600s default; both become 120s explicitly, sourced from a shared budget module:

```ts
const invokePortfolioEngine = createAgentInvocationState('InvokePortfolioEngine', 'CONSTRUCT_PORTFOLIO', {
  timeout: Duration.seconds(AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC),
  extraSubject: { /* unchanged */ },
});
```

Where `AGENT_BUDGETS` is a single small constants module owned by DWC (it is the orchestrator; it sets the budget; PE+AN consume the same constant in their stacks via `agentProfile({ uxBudgetSeconds: AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC, ... })`). The exact module path is an implementation detail decided in the follow-up workstream; the **principle** in this spec is: **one source of truth per agent budget, imported by both DWC's SF and the agent service's stack**.

### 4.5 Service-stack call shape

PE (`services/advisory/portfolio-engine-ctrl/src/service.stack.ts`):

```ts
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
    SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
    SecEdgarAdptEventTypes.SEC_10K_UPDATED,
  ],
  profile: agentProfile({
    agentLatencyP90Ms: 29_000,
    expectedBurstSize: 40,
    uxBudgetSeconds: AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC,
  }),
  lambdaProps: { paramsAndSecrets: PARAMS_AND_SECRETS_LAYER },
});
```

AN (`services/advisory/advisory-narrative-ctrl/src/service.stack.ts`): mirror with AN's numbers.

## 5. Math (canonical)

Notation: `p90 = agentLatencyP90Ms / 1000` (seconds), `burst = expectedBurstSize`, `ux = uxBudgetSeconds`, `m = visibilityMultiplier`.

```
lambdaTimeoutSec   = ceil(p90 × 1.5) + 5
sqsMaxConcurrency  = max(1, ceil(burst × p90 / ux))
visibilityTimeout  = lambdaTimeoutSec × m

INVARIANT:  visibilityTimeout ≤ ux × 2
```

**Drain rate under these settings**: `concurrency / p90 = ceil(burst × p90 / ux) / p90 ≈ burst / ux`. By construction, the queue drains within the UX budget at the planned burst. If burst exceeds planned size, drain runs over budget — the SF state fails fast and loudly. **Failure surfaces; it doesn't silently degrade.**

**Why `1.5 × p90 + 5s`** for the Lambda timeout: 1.5× p90 covers occasional p95-p99 spikes; the 5s flat margin covers Lambda cold-start (Node 24 ARM64 cold start is 200-1500ms per `feedback_node_lambda_cold_starts.md`).

**Why `visibilityMultiplier = 4` default** (not the CDK 6×): satisfies the invariant for typical `(p90, ux)` shapes. 4 retries within visibility before DLQ. Authors can override but the invariant catches any unsafe override.

### 5.1 Why not tune SQS→Lambda batching?

A natural question: would raising `sqsBatchSize` (currently 1) or `sqsMaxBatchingWindow` (currently 0s) help? Considered and rejected for this pattern:

1. **Per-call latency dominates invocation overhead.** Batching pays off when per-message work is small and Lambda invocation cost (cold start, warm-up) is comparable. Agent calls are 25-30s; the ~100ms warm-invocation cost is 0.4% of the work. Batching solves the wrong problem.
2. **Batching amplifies tail latency.** With `batchSize=N` and in-process `Promise.all`, the SQS-visible completion time equals the *slowest* agent call in the batch, not the average. A batch of 10 with one slow agent (60s) and nine fast ones (10s) resolves all ten SF task tokens at 60s. The SF deadline calculation would have to use `batch-p99` rather than `per-call p90`, strictly worsening the invariant math.
3. **Equivalent throughput is already in the concurrency lever.** `batchSize=N, concurrency=C` (parallel) gives `N × C / p90` effective rate — identical to `batchSize=1, concurrency=N×C`. The spec uses the latter because it has no tail-amplification penalty.
4. **`maxBatchingWindow > 0` adds queue-side latency.** Waiting to fill a batch directly trades against the SF deadline. For a deadline-bound pipeline, set it to 0.
5. **Batching complicates per-token error isolation.** Each SQS message carries one SF task token (via materializeToTable → CDC → DWC callback). With `batchSize > 1` the Lambda must implement `reportBatchItemFailures` so one bad agent call doesn't roll back the other N-1 successful writes. Not impossible, but added surface area without throughput gain.

**Decision**: keep `sqsBatchSize: 1` and `sqsMaxBatchingWindow: Duration.seconds(0)` in `agentProfile`. Lambda concurrency remains the sole throughput knob. Batching is the right lever for throughput-bound, latency-insensitive, fast-per-message workloads (CDC, projection materializers, hub fan-outs) — agent invocation is the opposite shape.

## 6. Initial values (PE + AN)

From CloudWatch Logs Insights, dev account, 7-day window ending 2026-05-18:

| Handler | n | p50 | p90 | p99 | max | avg |
|---|---|---|---|---|---|---|
| PE Ingress | 1326 | 17.6s | **28.8s** | 45.9s | 66.9s | 15.1s |
| AN Ingress | 1172 | 6.2s | **29.7s** | 53.7s | 59.7s | 9.5s |

Spec inputs (round up p90 to a clean number; size burst for 2× observed):

| Service | `agentLatencyP90Ms` | `expectedBurstSize` | `uxBudgetSeconds` | → Concurrency | → Lambda timeout | → Visibility (m=4) |
|---|---|---|---|---|---|---|
| **PE** | 29_000 | 40 | 120 | **10** | **49s** | **196s** |
| **AN** | 30_000 | 40 | 120 | **10** | **50s** | **200s** |

Invariant check: 196 ≤ 240 ✓ for PE, 200 ≤ 240 ✓ for AN.

Comparison vs. today:

| Setting | PE today | PE new | Delta |
|---|---|---|---|
| `sqsMaxConcurrency` | 5 | 10 | **+2×** |
| Lambda `timeout` | 300s | 49s | −6× (matched to p90, not over-provisioned) |
| SQS `visibilityTimeout` | 1800s | 196s | **−9×** (no more 30-min stale-message bounce) |
| SF `TimeoutSeconds` | 600s | 120s | **−5×** (fail-fast UX budget, not silent-success window) |

**On burst sizing**: burst=40 is derived from 2026-05-18 evidence (5+ concurrent SFs × ~8 agent calls each). The `× 1.5` factor I'd nominally bake into the helper to defend against under-estimation is **not** built in — instead authors should pass `expectedBurstSize` already containing the safety margin. This keeps the helper's math transparent (no hidden multipliers) and forces the author to defend their input.

**Re-tuning over time**: agent latency changes (model swaps, Bedrock improvements, prompt rewrites). The p90 inputs go stale. Re-derive at every workstream that materially changes agent latency (e.g., model migrations). A future improvement — out of scope for this spec — is a CI check that runs the CloudWatch query and warns when the deployed `p90Ms` drifts from observed reality by >20%.

## 7. Validation strategy

Owned by the **implementation workstream** (Complex-lane follow-up), not this spec:

**Unit tests** (`libs/cdk-constructs/test/utils/lambda-profiles.test.ts`):
- `agentProfile()` derivations: known inputs → exact outputs.
- Each input-validation guard throws with a specific message.
- Invariant violation throws with the failing inequality printed.
- `visibilityMultiplier` override path.

**CDK snapshot assertions** on PE + AN service stacks (existing `service.stack.test.ts` extended):
- SQS `VisibilityTimeout` resolves to 196s / 200s.
- Lambda `Timeout` resolves to 49s / 50s.
- ESM `MaximumConcurrency` resolves to 10.

**Integration tests**: existing PE + AN integration suites stay green. They exercise the full ingress→agent→materialize path. Confirm the new (shorter) Lambda timeout still accommodates p99 (PE p99=45.9s < 49s holds; AN p99=53.7s > 50s — **flagged**: AN's p99 currently exceeds the planned Lambda timeout. Either raise AN's p90 input to 35_000 (Lambda timeout becomes 58s) or accept p99 timeouts as the failure mode that surfaces tail-latency regression. **Decision deferred to implementation workstream.**).

**E2e gate**: scenarios `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (11) and `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (12) — **3 consecutive runs** must pass (per `feedback_flake_means_broken`). Pull CloudWatch evidence from any failing run before declaring done.

**Deploy validation**:
- `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl` plus any `cdk-constructs`-consumer redeploys (likely all advisory services because they all import the shared lib).
- During and after the e2e run: PE IngressQueue depth peaks ≤ planned burst; no `TaskTimedOut` SF events on `CONSTRUCT_PORTFOLIO` or `GENERATE_NARRATIVE` states; no Lambda timeouts in CloudWatch.

## 8. Rollback

This spec ships only as a doc — revert the spec commit to back out.

The implementation workstream is a pure config + helper change:
- `git revert` the cdk-constructs + DWC + PE + AN diffs.
- Redeploy. Old `(5, 1800, 600, 300)` values come back. No data migration, no state change.

## 9. Out of scope

From the backlog file (carry-forward verbatim):

- Inter-agent state handoff redesign — Phase A/B is correct as designed; this fix touches transport wiring only.
- Long-term Memory write latency on PE/AN — file separately if it dominates per-cycle latency.
- Re-introducing IP/MI to the per-cycle path — precomputation shipped 2026-05-17 and stays.
- Test-harness changes (EventBusTrap, AgentTraceTrap, fixture polling budgets).
- Compliance-ctrl or AssemblePacket state changes.
- The publisher-side bug tracked in `update-operating-mode-cdc-silent` (independent root cause).
- F1/F3 prevention via test gating — the architectural fix should make scenarios 11+12 deterministically green; gating heuristics are out of scope.

Spec-specific additions:

- **Bedrock TPS quota tracking.** The construct does not validate `concurrency × callRate ≤ modelRpm`. Current evidence says Bedrock TPS is not the binding constraint (PE handler is healthy; no throttle errors in CW). File separately if observed.
- **Pre-warming / reserved Lambda concurrency.** Only justified under sustained load; deferred.
- **AN's p90 tail reduction.** AN's p50 is 6.2s but p90 is 29.7s — a 4.8× spread that points at retry/prompt-discipline paths (α/γ from `project_agent_runtime_structured_output`) rather than steady-state decode. Compressing the tail (better prompt discipline, fewer retries) would drop AN's planned concurrency materially. Separate workstream; not blocking.
- **Backfill of `agentProfile` to other services.** Today only PE+AN match the SF→SQS→Lambda+deadline shape. If future agent services adopt the same pattern, they use `agentProfile`; no retrofit needed.
- **Runtime invariant alarms.** Synth-time guard is sufficient. CloudWatch alarms on visibility-vs-deadline are deferred.
- **Automated p90 drift CI check.** A future improvement; out of scope here.
- **Resolving AN p99 > planned Lambda timeout.** Flagged in §7; decided in the implementation workstream once the team chooses raise-p90 vs. accept-p99-tail-as-signal.

## 10. Open questions (for implementation workstream)

1. **Shared budget module path.** Spec mandates one source of truth per agent budget; the exact path (e.g., `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts`, exported and imported by PE+AN) is an implementation detail.
2. **AN p99 > planned Lambda timeout.** §7 flags this. Decision: raise AN `agentLatencyP90Ms` from 30_000 → 35_000 (concurrency stays at 10, timeout becomes 58s) **or** accept p99 timeouts as the surfacing signal that the agent regressed.
3. **Should `expectedBurstSize` carry an implicit safety multiplier?** Spec says no (transparency). Re-litigate if first deploy shows the planned-burst input was too tight.

## 11. Validation gate (for this spec workstream)

This spec ships when:
- The spec file lands in `docs/superpowers/specs/` and is committed.
- The user has reviewed it and approved.
- The follow-up Complex-lane implementation workstream is filed at `docs/backlog/<new-id>.md` referencing this spec.
