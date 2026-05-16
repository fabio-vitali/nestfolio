# Advisory cycle — agent precomputation + callback symmetry

**Status:** design
**Backlog:** [`docs/backlog/advisory-cycle-agent-precomputation.md`](../../backlog/advisory-cycle-agent-precomputation.md)
**Companion:** [`docs/backlog/agent-pipeline-backlog-trap-architectural.md`](../../backlog/agent-pipeline-backlog-trap-architectural.md) — independent; can ship in either order

## Problem

Two related concerns about the advisory cycle's agent pipeline:

**(1) Per-cycle agent invocation for inputs that don't depend on the trigger.** `investor-profile-ctrl` and `market-intelligence-ctrl` run once per decision cycle via the SF → EB → SQS → Lambda → AgentCore → `SendTaskSuccess` hop. Three numbers don't compose under e2e fan-out (SF `TimeoutSeconds=600s`, SQS `VisibilityTimeout=1800s`, Lambda `maxConcurrency=5`) — messages reach the Lambda after their task token has expired and stale messages keep bouncing through the queue for 30 minutes. Empirical evidence on 2026-05-16: `processingLagMs=1,800,450` on dev-investor-profile-ctrl IngressHandler, 3× the SF window.

Neither IP nor MI's reasoning is case-specific. IP's outputs are a function of the user's profile (goals interpretation + regulatory risk assessment). MI's outputs are a function of market state (singleton per region). Both can be precomputed on the events that actually change their inputs.

`portfolio-engine-ctrl`'s prompt at `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts:185-205` is parametrised only by `OperatingMode` and consumes upstream agent outputs as opaque structured payloads (no case-specific framing) — verified at `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:51-63`. Precomputation is structurally compatible for IP+MI.

**(2) Asymmetric SF callback pattern.** The 4 agent ctrls (IP/MI/PE/AN) call `states:SendTaskSuccess` directly via the `resumeStateMachine` event-processor pipeline. Compliance and user-confirmation use the opposite pattern — they write a DDB row, CDC emits a `*_COMPLETED`-class event, and `decision-workflow-ctrl-CallbackIngress` is the sole caller of `SendTaskSuccess`. The CallbackIngress already subscribes to `INVESTOR_PROFILE_COMPLETED`/`MARKET_ANALYSIS_COMPLETED`/`PORTFOLIO_COMPLETED`/`NARRATIVE_COMPLETED` (see `decision-workflow-ctrl/CLAUDE.md` Ingress section) — these subscriptions are dormant because the agent ctrls short-circuit via `resumeStateMachine`.

The asymmetry violates the "events only between services" hard constraint: agent ctrls today call `states:SendTaskSuccess` on a foreign service's API. It also creates a failure class where the agent run succeeds but the SDK callback fails (token expiry, throttle, cold-start race) and the SF stalls.

This spec resolves both: IP+MI exit the cycle entirely (concern 1); PE+AN refactor to emit `*_COMPLETED` events that CallbackIngress resumes (concern 2). After both land, **`decision-workflow-ctrl` is the only service in the system that calls `states:SendTaskSuccess` or `states:SendTaskFailure`.**

## Goals

1. Eliminate `ANALYZE_INVESTOR_PROFILE` and `ANALYZE_MARKET` from the decision cycle.
2. Materialise `InvestorProfileSnapshot` (per user) and `MarketSnapshot` (per region) continuously from upstream events.
3. Preserve the existing SF state shape (`$.agentResults.InvokeInvestorProfile.agentOutput`, `$.agentResults.InvokeMarketIntelligence.agentOutput`) so `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, and `AssemblePacket` consume snapshots without code changes.
4. Generalise payload-first projection reads in the SF so trigger events that carry authoritative state win over potentially-stale projections.
5. Refactor `portfolio-engine-ctrl` and `advisory-narrative-ctrl` so they emit `*_COMPLETED`/`*_FAILED` events instead of calling `states:SendTaskSuccess` directly. `decision-workflow-ctrl-CallbackIngress` becomes the sole caller of `states:SendTaskSuccess`/`SendTaskFailure` for the cycle.

## Non-goals (out of scope)

- **PE+AN as agent runs**: their LangGraph + KB + per-cycle invocation stay (case-specific, cannot be precomputed). Only their **callback transport** changes (direct SDK call → emit-and-CDC).
- **PE+AN queue-trap timing knobs** (SF TimeoutSeconds, SQS VisibilityTimeout, Lambda maxConcurrency): addressed by [`agent-pipeline-backlog-trap-architectural`](../../backlog/agent-pipeline-backlog-trap-architectural.md). The callback refactor moves where `SendTaskSuccess` is called — it does not change the SF→agent forward-path concurrency model.
- KB ingestion paths (Regulatory KB, Market KB) — unaffected.
- AgentCore Memory namespace changes — Phase-A handoff is correct as designed.
- Authority resolution / operating-mode logic in `compliance-ctrl` — already lives in `MandateSnapshot` + `compliance-ctrl` rule engine.
- Production rollout sequencing — dev-first; prod posture decided separately.
- Cross-region or multi-region snapshot replication.
- Snapshot retention / archival policy.
- Compliance + user-confirmation callback paths — already follow the target pattern; no change.

## Chosen approach: atomic cutover

The dev sandbox is disposable; breaking changes are free per the `feedback-no-deprecation` rule. The trigger-payload-precedence resolution removes the main correctness risk a shadow phase would catch. Snapshot-population invariants are enforceable up-front (onboarding always materialises before the first cycle).

Alternatives considered:

| Approach | Verdict | Reason |
|---|---|---|
| **A. Atomic cutover** | **Chosen** | Smallest delta; rollback is a single revert; no shadow-phase code to delete |
| B. Shadow mode → cutover | Rejected | Shadow code deletes itself at cutover, doubling churn; dev-only ship doesn't justify the safety margin |
| C. Permanent in-cycle fallback | Rejected | Preserves half the trap surface; two code paths forever |

## Architecture

### Service repurposing

```
investor-profile-ctrl
  Ingress subscriptions:
    - INVESTOR_PROFILE_UPDATED   (per-user; from investor-bff)
    - MANDATE_ISSUED              (per-user; from investor-bff)
    - OPERATING_MODE_CHANGED      (per-user; from investor-bff)
    REMOVED: ANALYZE_INVESTOR_PROFILE
  Agent: unchanged (LangGraph user-goals Haiku + risk-assessment Opus, parallel)
  Output: writes InvestorProfileSnapshot DDB row
  KB: RegulatoryKB unchanged
  Memory: agent's own writes via openDecisionSession unchanged (out of scope here)

market-intelligence-ctrl
  Ingress subscriptions:
    - YAHOO_FINANCE_UPDATED       (fast-tier rebuild)
    - MARKETWATCH_UPDATED         (fast-tier rebuild)
    - SEC_8K_FILED                (fast-tier rebuild)
    - FRED_INDICATORS_UPDATED     (fast-tier rebuild)
    - ALPHA_VANTAGE_NEWS_UPDATED  (fast-tier rebuild)
    - NEW: MARKET_SNAPSHOT_REFRESH_TICK (slow-tier rebuild; 15-min EventBridge schedule)
    REMOVED: ANALYZE_MARKET
  Agent: unchanged (LangGraph single-node Sonnet + deterministic context pre-fetch)
  Output: writes/merges MarketSnapshot DDB row (per region)
  KB: MarketKB unchanged (already populated by these feed events)
  Memory: out of scope here

portfolio-engine-ctrl (CALLBACK REFACTOR)
  Ingress unchanged: subscribes to CONSTRUCT_PORTFOLIO (waitForTaskToken trigger from SF)
  Handler shape changes:
    OLD: resumeStateMachine pipeline → SendTaskSuccess called directly inside Lambda
    NEW: standard event-processor pipeline → handler writes AgentCompletion row (success)
         or AgentFailure row (exception caught), returns. CDC emits PORTFOLIO_COMPLETED
         or PORTFOLIO_FAILED. CallbackIngress receives and calls states:SendTaskSuccess
         or states:SendTaskFailure.
  IAM: states:SendTaskSuccess + states:SendTaskFailure permissions REMOVED from Lambda role
  Agent: unchanged (LangGraph portfolio-construction Opus + rebalance-planner Sonnet)

advisory-narrative-ctrl (CALLBACK REFACTOR)
  Same shape as portfolio-engine-ctrl. Emits NARRATIVE_COMPLETED / NARRATIVE_FAILED via CDC.

decision-workflow-ctrl
  decision-state-machine.ts:
    REMOVED:    ParallelProfiling { InvokeInvestorProfile, InvokeMarketIntelligence }, MergeParallelOutputs
    REPLACED:   Two parallel dynamodb:GetItem Task states (LookupInvestorProfileSnapshot + LookupMarketSnapshot)
    GENERALISED: LookupMandateSnapshot + SetInvestorProfile chain wrapped in a payload-first Choice
    UNCHANGED structurally: InvokePortfolioEngine + InvokeAdvisoryNarrative remain putEvents.waitForTaskToken
                            states; only the agent-side response shape changes
    UNCHANGED:  AssembleDecisionPacket, WaitForCompliance, downstream
  CallbackIngress:
    Already subscribes to PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED — wires activate
    NEW subscriptions: PORTFOLIO_FAILED, NARRATIVE_FAILED (calls states:SendTaskFailure)
    sfn-callback.ts: extend agent-completion branch to handle the new shape (taskToken + agentOutput on subject)
```

### Snapshot schemas

```typescript
// services/advisory/investor-profile-ctrl/src/domain/models.ts
interface InvestorProfileSnapshot {
  pk: `InvestorProfileSnapshot#${tenantId}#${userId}`;
  sk: 'InvestorProfileSnapshot';
  __typename: 'InvestorProfileSnapshot';
  tenantId: string;
  userId: string;
  // agentOutput matches today's IP SendTaskSuccess shape verbatim, so PE/AN/AssemblePacket
  // consume it without changes (services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:51).
  agentOutput: {
    goals: string[];
    timeHorizon: string;
    riskWillingness: string;
    riskScore: number;
    riskCategory: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
    regulatoryFlags: string[];
    suitabilityAssessment: string;
    confidence: number;
  };
  sourceEventId: string;          // event id that triggered this rebuild — idempotency anchor
  sourceEventType: 'INVESTOR_PROFILE_UPDATED' | 'MANDATE_ISSUED' | 'OPERATING_MODE_CHANGED';
  agentInvocationId: string;      // links to AgentInvocation row
  updatedAt: string;              // ISO8601
}

// services/advisory/portfolio-engine-ctrl/src/domain/models.ts
// services/advisory/advisory-narrative-ctrl/src/domain/models.ts
// (identical shape; both services own a copy of the type)
interface AgentCompletion {
  pk: `AgentCompletion#${decisionId}`;
  sk: `AgentCompletion#${agentName}`;     // partition by decision; sort by agent
  __typename: 'AgentCompletion';
  decisionId: string;
  tenantId: string;
  agentName: 'portfolio-engine' | 'advisory-narrative';
  taskToken: string;                       // echoed back from the SF putEvents detail
  agentOutput: Record<string, unknown>;    // shape varies per agent
  completedAt: string;                     // ISO8601
}

interface AgentFailure {
  pk: `AgentFailure#${decisionId}`;
  sk: `AgentFailure#${agentName}`;
  __typename: 'AgentFailure';
  decisionId: string;
  tenantId: string;
  agentName: 'portfolio-engine' | 'advisory-narrative';
  taskToken: string;
  errorType: string;                       // 'DegradedAgentOutputError' | 'BedrockThrottle' | 'UnknownOperatingModeError' | ...
  errorMessage: string;
  failedAt: string;
}

// services/advisory/market-intelligence-ctrl/src/domain/models.ts
interface MarketSnapshot {
  pk: `MarketSnapshot#${region}`;
  sk: 'MarketSnapshot';
  __typename: 'MarketSnapshot';
  region: string;                 // 'us-east-1' today; singleton per region
  // agentOutput matches today's MI SendTaskSuccess shape verbatim.
  agentOutput: {
    signals: Array<{
      type: string;
      ticker: string;
      sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      confidence: number;
      source: string;
    }>;
    tickersMentioned: string[];
    marketOutlook: string;
    confidenceScore: number;
  };
  fastComponentsAt: string;       // last feed-driven rebuild (ISO8601)
  slowComponentsAt: string;       // last scheduled rebuild (ISO8601)
  sourceEventIds: string[];       // ring buffer (last 20) — dedup ledger for feed events
  updatedAt: string;
}
```

### Event contracts

**New events (Egress CDC):**

```
# Precomputation snapshots
INVESTOR_PROFILE_SNAPSHOT_CREATED   (InvestorProfileSnapshot:INSERT  — investor-profile-ctrl)
INVESTOR_PROFILE_SNAPSHOT_UPDATED   (InvestorProfileSnapshot:MODIFY  — investor-profile-ctrl)
MARKET_SNAPSHOT_UPDATED             (MarketSnapshot:MODIFY  — market-intelligence-ctrl; INSERT collapses to UPDATED for simpler consumer logic)
MARKET_SNAPSHOT_REFRESH_TICK        (EventBridge schedule rule → advisoryBus; consumed by market-intelligence-ctrl Ingress only)

# Callback refactor (PE + AN)
PORTFOLIO_FAILED                    (AgentFailure:INSERT  — portfolio-engine-ctrl)
NARRATIVE_FAILED                    (AgentFailure:INSERT  — advisory-narrative-ctrl)
```

**Repurposed events:** `PORTFOLIO_COMPLETED` and `NARRATIVE_COMPLETED` already exist in `PortfolioEngineEventTypes` and `AdvisoryNarrativeEventTypes` but are not currently emitted. Post-refactor, they're emitted via CDC on `AgentCompletion:INSERT`. Their existing CallbackIngress subscriptions activate. `INVESTOR_PROFILE_COMPLETED` and `MARKET_ANALYSIS_COMPLETED` are dropped from `AGENT_COMPLETION_EVENT_TYPES` and their CallbackIngress subscriptions removed — they're gone post-precomputation.

**Removed events:** `ANALYZE_INVESTOR_PROFILE`, `ANALYZE_MARKET` no longer emitted by `decision-workflow-ctrl` and no longer subscribed by IP/MI ctrls. `INVESTOR_PROFILE_COMPLETED` and `MARKET_ANALYSIS_COMPLETED` deleted entirely. All four constants removed from `DecisionWorkflowEventTypes` / `InvestorProfileEventTypes` / `MarketIntelligenceEventTypes` in the same ship.

**Retained:** All 7 trigger events, all CDC-emitted observability/audit events (`PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `EXPLANATION_GENERATED`, `MARKET_SIGNAL_DETECTED`, etc.), all compliance + user-confirm events.

### Payload-first projection reads (generalised)

The SF reads three projections. Each read uses one of two patterns:

| Projection | Trigger may carry payload? | Pattern |
|---|---|---|
| `InvestorProfileSnapshot` | Yes — `INVESTOR_PROFILE_UPDATED` carries `goal`, `riskProfile`, `accountMode` blocks | Choice: payload-present → hoist; else → DDB GetItem |
| `MandateSnapshot` | Yes — `INVESTOR_PROFILE_UPDATED` carries `operatingMode` + full `mandate` block | Choice: payload-present → hoist; else → DDB GetItem |
| `MarketSnapshot` | No — no trigger event carries market state | Always DDB GetItem |

**Why this matters for MandateSnapshot.** Today's SF reads `MandateSnapshot.operatingMode` unconditionally (decision-state-machine.ts:381–411). The comment claims single-path safety, but there's a real race: `OPERATING_MODE_CHANGED` updates `MandateSnapshot.operatingMode` (MODIFY); CDC only fires on INSERT (per `services/advisory/decision-workflow-ctrl/CLAUDE.md` Egress section), so mode changes do not fire `MANDATE_SNAPSHOT_CREATED`. If `INVESTOR_PROFILE_UPDATED` reaches the SF before the projector catches up, the SF reads the old mode. The trigger payload carries the truth (`fixtures.ts:251–272` confirms `operatingMode` + full `mandate` block are inline) — preferring it eliminates the race.

**Why this matters for InvestorProfileSnapshot.** Same race class. The `INVESTOR_PROFILE_UPDATED` trigger payload carries enough to skip the projection entirely for the fields the SF asserts on (`operatingMode`, `goal`, `riskProfile`). For non-profile triggers (DEPOSIT_DETECTED, ORDER_FILLED, etc.), the trigger payload doesn't carry profile fields — the SF falls through to the GetItem. The projection is guaranteed materialised by an earlier onboarding event.

**Why MarketSnapshot stays GetItem-only.** No trigger event carries market state. The cycle always reads the latest snapshot.

**Implementation shape (CDK / ASL):**

```typescript
// pseudo-CDK — replaces LookupMandateSnapshot + SetInvestorProfile and ParallelProfiling
const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
  .when(
    sfn.Condition.isPresent('$.triggerContext.goal'),
    new sfn.Pass(this, 'HoistInvestorProfileFromTrigger', {
      parameters: { 'agentOutput.$': '$.triggerContext' /* shape-adapted */ },
      resultPath: '$.agentResults.InvokeInvestorProfile',
    }),
  )
  .otherwise(
    new sfn.CustomState(this, 'LookupInvestorProfileSnapshot', { /* GetItem */ }),
  );

const resolveMandateSnapshot = new sfn.Choice(this, 'ResolveMandateSnapshot')
  .when(
    sfn.Condition.isPresent('$.triggerContext.operatingMode'),
    new sfn.Pass(this, 'HoistMandateFromTrigger', { /* hoist operatingMode + mandate block */ }),
  )
  .otherwise(
    new sfn.CustomState(this, 'LookupMandateSnapshot', { /* existing GetItem, unchanged */ }),
  );

const lookupMarketSnapshot = new sfn.CustomState(this, 'LookupMarketSnapshot', { /* GetItem, always */ });

// Parallel: resolveInvestorProfile + lookupMarketSnapshot
// Sequential after: resolveMandateSnapshot → InvokePortfolioEngine → InvokeAdvisoryNarrative → ...
```

The shape-adapter Pass for `HoistInvestorProfileFromTrigger` flattens the trigger payload's `goal`/`riskProfile`/`accountMode` into the same field names the projection writes (`goals`/`timeHorizon`/`riskScore`/etc.). Where the trigger doesn't carry a field (e.g. `regulatoryFlags`, `suitabilityAssessment`), the hoist writes empty defaults — PE+AN already accept these as optional structured input per `services/advisory/investor-profile-ctrl/src/agents/schemas.ts`.

## Callback refactor — agent → event → CallbackIngress → SF

### Why CDC, not direct PutEvents

The agent ctrl could emit the `*_COMPLETED` event directly via `events:PutEvents` after the agent run. We choose the CDC path (write `AgentCompletion` DDB row → CDC publisher emits the event) for two reasons:

1. **Idempotency for free.** Standard `record('AgentCompletion', { decisionId, agentName }, { idempotencyKey: ctx.eventId })` via event-processor. SQS redelivery of the same trigger event id → no second emission. Matches the compliance pattern exactly.
2. **Durable audit row.** The completion is queryable in DDB independent of EventBridge retention. Useful for incident replay and aligns with how compliance + advisory-bff already work.

### Handler shape

**Old (`resumeStateMachine`):**

```typescript
export const handler = resumeStateMachine({
  serviceName: 'portfolio-engine-ctrl',
  handlers: {
    CONSTRUCT_PORTFOLIO: async (payload, ctx) => {
      const result = await agentService.runPipeline(...);
      return { output: { decisionId, agentOutput: result } };
      // resumeStateMachine internally calls states:SendTaskSuccess with output
    },
  },
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED',
});
```

**New (standard pipeline + emit-and-callback):**

```typescript
export const handler = ingressPipeline({
  serviceName: 'portfolio-engine-ctrl',
  handlers: {
    CONSTRUCT_PORTFOLIO: async (payload, ctx) => {
      const taskToken = payload.subject.taskToken;
      const decisionId = payload.subject.decisionId;
      try {
        const result = await agentService.runPipeline(...);
        return {
          output: { decisionId },
          intents: [
            record('AgentInvocation', { decisionId, agentName: 'portfolio-engine' }),  // unchanged audit row
            record('AgentCompletion', {
              decisionId,
              agentName: 'portfolio-engine',
              taskToken,
              agentOutput: result,
            }),  // NEW — CDC fires PORTFOLIO_COMPLETED with taskToken on subject
          ],
        };
      } catch (err) {
        return {
          output: { decisionId, failed: true },
          intents: [
            record('AgentFailure', {
              decisionId,
              agentName: 'portfolio-engine',
              taskToken,
              errorType: err.name ?? 'UnknownError',
              errorMessage: err.message,
            }),  // NEW — CDC fires PORTFOLIO_FAILED with taskToken on subject
          ],
        };
        // No re-throw: the failure is delivered via event, not via SQS-retry/DLQ.
        // SQS-retry would mean re-running the agent on the same task token, which
        // is the wrong default — CallbackIngress decides whether to retry via SF state.
      }
    },
  },
});
```

The `ingressPipeline` is the existing standard event-processor pipeline used by every non-SF-resuming ingress handler. The "no re-throw on agent failure" choice matches how compliance handles `RECOMMENDATION_PROPOSED` errors (writes `ComplianceCheck` with `result=BLOCKED`, doesn't re-throw).

### Egress wiring (per service)

```typescript
// services/advisory/portfolio-engine-ctrl/src/service.stack.ts
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'AgentInvocation': { insert: PortfolioEngineEventTypes.PORTFOLIO_CONSTRUCTION_PROPOSED },  // unchanged
    'ReasoningOutput': { insert: PortfolioEngineEventTypes.REBALANCE_PLAN_PRODUCED },           // unchanged
    'AgentCompletion': { insert: PortfolioEngineEventTypes.PORTFOLIO_COMPLETED },               // NEW
    'AgentFailure':    { insert: PortfolioEngineEventTypes.PORTFOLIO_FAILED },                  // NEW
  },
});
```

The CDC publisher already projects DDB row fields onto the EB event subject — `taskToken` lands on `subject.taskToken` automatically.

### CallbackIngress on the receiving end

`sfn-callback.ts` already handles `INVESTOR_PROFILE_COMPLETED`/`MARKET_ANALYSIS_COMPLETED`/`PORTFOLIO_COMPLETED`/`NARRATIVE_COMPLETED` per `decision-workflow-ctrl/CLAUDE.md`. Post-change:

- IP/MI completions: subscriptions removed (those services are out of the cycle).
- PE/AN completions: subscriptions activate. Handler reads `subject.taskToken` + `subject.agentOutput` and calls `states:SendTaskSuccess({ taskToken, output: agentOutput })`.
- PE/AN failures (new subscriptions for `PORTFOLIO_FAILED`/`NARRATIVE_FAILED`): handler calls `states:SendTaskFailure({ taskToken, error, cause })`.

### IAM consequences

| Service | states:SendTaskSuccess | states:SendTaskFailure |
|---|---|---|
| `investor-profile-ctrl` | REMOVED (out of cycle) | REMOVED |
| `market-intelligence-ctrl` | REMOVED (out of cycle) | REMOVED |
| `portfolio-engine-ctrl` | REMOVED (callback refactor) | REMOVED |
| `advisory-narrative-ctrl` | REMOVED (callback refactor) | REMOVED |
| `decision-workflow-ctrl` | granted (existing CallbackIngress role) | granted |

**Post-ship invariant:** Only `decision-workflow-ctrl-CallbackIngress` holds `states:SendTaskSuccess`/`states:SendTaskFailure` permissions in the entire codebase. Enforceable via a CDK snapshot test in `decision-workflow-ctrl/test/unit/service.stack.test.ts`.

### Failure modes

- **Agent run succeeds, AgentCompletion write fails (DDB throttle):** Lambda throws, SQS redelivers, idempotency key (`ctx.eventId`) ensures single write. SF still waits.
- **Agent run fails, AgentFailure write fails:** same path — SQS redelivers. After max-retries, message goes to DLQ; SF eventually times out at 600s. CloudWatch alarm on DLQ depth is the existing path.
- **CDC emission fails:** existing event-publisher retry logic (same path used by compliance today).
- **CallbackIngress receives event but SendTaskSuccess fails (token expired):** the new `agent-pipeline-task-token-timeout-observability` logging surface (shipped 2026-05-16) captures `processingLagMs` for this case. The trap-architectural workstream addresses the root cause.

## Triggering and idempotency

### investor-profile-ctrl

| Trigger | Action |
|---|---|
| `INVESTOR_PROFILE_UPDATED` | Run user-goals + risk-assessment agents; write `InvestorProfileSnapshot` |
| `MANDATE_ISSUED` | Run agents on the mandate's investor profile context; write `InvestorProfileSnapshot` |
| `OPERATING_MODE_CHANGED` | Run agents (risk assessment may shift with mode); write `InvestorProfileSnapshot` |

Idempotency: `record('InvestorProfileSnapshot', { tenantId, userId }, { idempotencyKey: ctx.eventId })` via event-processor. Same trigger event id replayed → no second agent run.

### market-intelligence-ctrl

| Trigger | Action |
|---|---|
| Feed event (5 types) | Run agent; merge fast components into `MarketSnapshot`; update `fastComponentsAt` |
| `MARKET_SNAPSHOT_REFRESH_TICK` (15-min schedule) | Run agent; rebuild slow components; update `slowComponentsAt` |

Idempotency: dedup ledger via `sourceEventIds` ring buffer in the row. Each feed event's id appended; if already present, skip the agent run. Scheduled ticks always run (no dedup needed; cadence-bounded).

Concurrency: keep current Lambda `maxConcurrency=5` — feed events are low-volume; scheduled ticks are 1/15min. The trap surface here was per-cycle fan-out, which is now gone.

### decision-workflow-ctrl

No idempotency change for the cycle itself. The SF execution name is auto-generated (existing behaviour); the projections it reads are eventually consistent but acceptable because either the trigger carries the latest payload (Choice path) or the projection has materialised before the SF starts (GetItem path).

## End-to-end flow (post-change)

```
Trigger event fires SF execution
  │
  UnpackTriggerEnvelope                      (unchanged)
  │
  ┌─── ResolveInvestorProfile (Choice)
  │     ├── payload present → HoistFromTrigger
  │     └── else           → LookupInvestorProfileSnapshot (GetItem)
  │
  LookupMarketSnapshot (GetItem, parallel branch)
  │
  ResolveMandateSnapshot (Choice)
    ├── payload present → HoistMandateFromTrigger
    └── else           → LookupMandateSnapshot (GetItem)
  │
  InvokePortfolioEngine (putEvents.waitForTaskToken)
    ├── SF emits CONSTRUCT_PORTFOLIO with taskToken on subject
    ├── portfolio-engine-ctrl Ingress handles → agent runs → AgentCompletion row written
    ├── CDC emits PORTFOLIO_COMPLETED with taskToken on subject
    └── decision-workflow-ctrl-CallbackIngress → states:SendTaskSuccess(taskToken, output)
  │
  InvokeAdvisoryNarrative (putEvents.waitForTaskToken)
    └── Same shape as PE: emit NARRATIVE_COMPLETED via CDC → CallbackIngress resumes
  │
  AssembleDecisionPacket (lambda:invoke; unchanged)
  │
  WaitForCompliance → ComplianceChoice → … (unchanged)
```

Latency contribution from "Phase 1" drops from 5–30 s (two agent calls) to <100 ms (two DDB GetItems + zero or two Pass states). Per-cycle agent count drops from 4 to 2. PE+AN add ~200-500 ms each for the extra EB→SQS→Lambda hop in the callback path — small relative to the 5-30 s Bedrock invocation they wrap.

## E2E fixture impact

- **`onboarded()`** (`apps/e2e-feature-tests/src/helpers/fixtures.ts:64–113`) — chain already produces an `INVESTOR_PROFILE_UPDATED` via the `ONBOARDING_COMPLETED → composite InvestorProfile row → CDC` path. Post-change, this also drives `investor-profile-ctrl` to materialise the first `InvestorProfileSnapshot`. Add a DDB-poll for `InvestorProfileSnapshot#{tenantId}#{userId}` existence before returning, mirroring the `CashBalance` pattern in `funded()` (`fixtures.ts:140–152`).
- **`withLiveDecision()`** (`fixtures.ts:213–298`) — outward shape unchanged. Faster cycle (no per-cycle IP+MI agent calls), so `timeoutMs` default drops from 180 s → 90 s as a starting estimate. Update after measuring on dev.
- **`MarketSnapshot` seeding** — fresh dev environment needs a bootstrap. Add a one-time backfill at the end of `infrastructure/scripts/deploy.sh` that publishes one synthetic feed event per region, blocking until the snapshot materialises. Without it, the first cycle on a freshly-deployed environment sees an empty `MarketSnapshot` GetItem and PE receives empty `marketAnalysis`.

## Testing

### Unit

- `investor-profile-ctrl`: add handler tests for the three new ingress event types. Each follows the existing `ANALYZE_INVESTOR_PROFILE` test shape — different trigger envelope, same agent invocation, asserts an `InvestorProfileSnapshot` write intent. Delete the `ANALYZE_INVESTOR_PROFILE` handler test.
- `market-intelligence-ctrl`: add handler tests for each of the 5 feed events (fast-tier merge) plus `MARKET_SNAPSHOT_REFRESH_TICK` (slow-tier rebuild). Delete the `ANALYZE_MARKET` handler test.
- `portfolio-engine-ctrl` + `advisory-narrative-ctrl`: rewrite `event-listener.test.ts` to assert: (a) on success, handler emits `AgentInvocation` + `AgentCompletion` write intents (no SendTaskSuccess call); (b) on agent error, handler emits `AgentFailure` write intent (no SendTaskFailure call, no re-throw); (c) `taskToken` is propagated from `subject.taskToken` onto the AgentCompletion/Failure row.
- `decision-workflow-ctrl`: add SF-state assertion tests for the new Choice + GetItem states. Cover both Choice branches (payload-present vs payload-absent) for IP and Mandate. Add `service.stack.test.ts` CDK snapshot assertion that **no service except `decision-workflow-ctrl-CallbackIngress` is granted `states:SendTaskSuccess` or `states:SendTaskFailure`** — runs as a per-service stack assertion in the IP/MI/PE/AN unit suites too.
- `decision-workflow-ctrl` `sfn-callback.test.ts`: extend the agent-completion branch tests with PE/AN success + failure shapes; assert SendTaskSuccess/SendTaskFailure are called with the expected taskToken + output.

### Integration

- `investor-profile-ctrl/test/integration/`: scenario "snapshot materialised on profile update" — publish `INVESTOR_PROFILE_UPDATED`, poll for `InvestorProfileSnapshot` row, assert `agentOutput` shape matches schema.
- `market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`: extend with "fast-tier merge on feed event" + "slow-tier rebuild on schedule" scenarios. Idempotency: replay the same feed event id, assert single agent run.
- `portfolio-engine-ctrl/test/integration/`: new scenario "CONSTRUCT_PORTFOLIO triggers AgentCompletion CDC emission of PORTFOLIO_COMPLETED carrying taskToken" — use EventBusTrap to assert the emission. New scenario "agent exception writes AgentFailure → emits PORTFOLIO_FAILED with taskToken". Same shape for `advisory-narrative-ctrl/test/integration/`.
- `decision-workflow-ctrl/test/integration/`: add SF-execution scenario asserting the payload-first Choice branches behave correctly. Use a synthetic `INVESTOR_PROFILE_UPDATED` trigger with operatingMode='AGGRESSIVE' inline, but write `BALANCED` to the projection — assert PE receives `AGGRESSIVE`. Add CallbackIngress integration test asserting `PORTFOLIO_COMPLETED`/`PORTFOLIO_FAILED` / `NARRATIVE_COMPLETED`/`NARRATIVE_FAILED` events properly resume / fail the SF execution.

### E2E

- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (scenario 11) — expected to drop from 180 s window to ~60 s. Pass/fail criterion unchanged.
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (scenario 12) — same. The proposal's "may unblock 11+12 alone" claim becomes a measurable outcome of this ship.

## Rollback

Single revert commit on the implementation PR. Snapshot tables and CDC events become orphaned in dev (purge on next deploy). SF state machine reverts to the current 4-agent parallel+sequential shape. No data migration needed (dev is disposable).

## Validation gate

The implementation workstream's `validation_gate` is satisfied when all of:

1. `pnpm nx affected -t test,lint --base=origin/main` green (includes the new CDK snapshot assertion forbidding `states:SendTaskSuccess` outside `decision-workflow-ctrl`)
2. `pnpm nx affected -t test-integration --base=origin/main` green (`investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, `decision-workflow-ctrl`)
3. Dev deploy of `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, `decision-workflow-ctrl` completes via `infrastructure/scripts/deploy.sh sandbox --prefix=dev`
4. E2E scenarios `first-decision` + `rebalance-on-drift` pass on dev (single targeted run each)
5. CloudWatch Logs Insights confirms zero `ANALYZE_INVESTOR_PROFILE` / `ANALYZE_MARKET` events on advisoryBus over a 30-min window post-ship
6. CloudWatch shows non-zero `INVESTOR_PROFILE_SNAPSHOT_CREATED`, `MARKET_SNAPSHOT_UPDATED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED` event volume in the same window
7. IAM audit: `aws iam list-attached-role-policies` for the PE/AN/IP/MI Lambda roles in account 771924376645 shows no policy granting `states:SendTaskSuccess` or `states:SendTaskFailure`

## Open questions deferred to the plan phase

- Exact SSM parameter wiring for `MARKET_SNAPSHOT_REFRESH_TICK` schedule rate (15-min hardcoded vs SSM-tunable).
- Whether the deploy-script feed-event bootstrap should be a backfill Lambda, a CDK custom resource, or a manual one-time step.
- Whether `InvestorProfileSnapshot` should retain agent-tracing fields (token counts, model id, latency) for observability parity with today's `AgentInvocation` row.
- Whether `AgentCompletion` rows should TTL-expire (cleanup after N days) — they're audit-only post-callback. Same question for `AgentFailure`.
- Whether to extract a reusable `cdk-constructs/extensions/agent-callback-pipeline` helper or inline the AgentCompletion/AgentFailure row types + Egress mappings in each of PE+AN.

These are implementation details that don't affect the architectural shape; resolve in `writing-plans`.

## References

- Backlog: [`docs/backlog/advisory-cycle-agent-precomputation.md`](../../backlog/advisory-cycle-agent-precomputation.md)
- Companion: [`docs/backlog/agent-pipeline-backlog-trap-architectural.md`](../../backlog/agent-pipeline-backlog-trap-architectural.md)
- Data flow: [`docs/data-flows/advisory-cycle.md`](../../data-flows/advisory-cycle.md)
- Architecture: [`docs/architecture/SYSTEM-ARCHITECTURE.md`](../../architecture/SYSTEM-ARCHITECTURE.md), [`docs/architecture/SERVICE-INVENTORY.md`](../../architecture/SERVICE-INVENTORY.md)
- Code:
  - `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
  - `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
  - `services/advisory/investor-profile-ctrl/src/agents/{prompts,schemas}.ts`
  - `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`
  - `services/advisory/market-intelligence-ctrl/src/agents/{prompts,schemas}.ts`
  - `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`
  - `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts`
  - `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`
  - `apps/e2e-feature-tests/src/helpers/fixtures.ts`
