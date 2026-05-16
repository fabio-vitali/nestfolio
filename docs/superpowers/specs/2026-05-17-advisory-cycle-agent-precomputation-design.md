# Advisory cycle — agent precomputation (IP + MI)

**Status:** design
**Backlog:** [`docs/backlog/advisory-cycle-agent-precomputation.md`](../../backlog/advisory-cycle-agent-precomputation.md)
**Companion:** [`docs/backlog/agent-pipeline-backlog-trap-architectural.md`](../../backlog/agent-pipeline-backlog-trap-architectural.md) — independent; can ship in either order

## Problem

`investor-profile-ctrl` and `market-intelligence-ctrl` run once per decision cycle via the SF → EB → SQS → Lambda → AgentCore → `SendTaskSuccess` hop. Three numbers don't compose under e2e fan-out (SF `TimeoutSeconds=600s`, SQS `VisibilityTimeout=1800s`, Lambda `maxConcurrency=5`) — messages reach the Lambda after their task token has expired and stale messages keep bouncing through the queue for 30 minutes. Empirical evidence on 2026-05-16: `processingLagMs=1,800,450` on dev-investor-profile-ctrl IngressHandler, 3× the SF window.

Neither agent's reasoning is case-specific. `investor-profile-ctrl`'s outputs are a function of the user's profile (goals interpretation + regulatory risk assessment). `market-intelligence-ctrl`'s outputs are a function of market state (singleton per region). Both can be precomputed on the events that actually change their inputs.

`portfolio-engine-ctrl`'s prompt at `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts:185-205` is parametrised only by `OperatingMode` and consumes upstream agent outputs as opaque structured payloads (no case-specific framing) — verified at `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:51-63`. Precomputation is structurally compatible.

## Goals

1. Eliminate `ANALYZE_INVESTOR_PROFILE` and `ANALYZE_MARKET` from the decision cycle.
2. Materialise `InvestorProfileSnapshot` (per user) and `MarketSnapshot` (per region) continuously from upstream events.
3. Preserve the existing SF state shape (`$.agentResults.InvokeInvestorProfile.agentOutput`, `$.agentResults.InvokeMarketIntelligence.agentOutput`) so `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, and `AssemblePacket` consume snapshots without code changes.
4. Generalise payload-first projection reads in the SF so trigger events that carry authoritative state win over potentially-stale projections.

## Non-goals (out of scope)

- `portfolio-engine-ctrl` + `advisory-narrative-ctrl` — case-specific, stay in the cycle. Their queue-trap surface is addressed by [`agent-pipeline-backlog-trap-architectural`](../../backlog/agent-pipeline-backlog-trap-architectural.md).
- KB ingestion paths (Regulatory KB, Market KB) — unaffected.
- AgentCore Memory namespace changes — Phase-A handoff is correct as designed.
- Authority resolution / operating-mode logic in `compliance-ctrl` — already lives in `MandateSnapshot` + `compliance-ctrl` rule engine.
- Production rollout sequencing — dev-first; prod posture decided separately.
- Cross-region or multi-region snapshot replication.
- Snapshot retention / archival policy.
- Pipeline wiring tuning for PE+AN.

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

decision-workflow-ctrl
  decision-state-machine.ts:
    REMOVED:    ParallelProfiling { InvokeInvestorProfile, InvokeMarketIntelligence }, MergeParallelOutputs
    REPLACED:   Two parallel dynamodb:GetItem Task states (LookupInvestorProfileSnapshot + LookupMarketSnapshot)
    GENERALISED: LookupMandateSnapshot + SetInvestorProfile chain wrapped in a payload-first Choice
    UNCHANGED:  InvokePortfolioEngine, InvokeAdvisoryNarrative, AssembleDecisionPacket, WaitForCompliance, downstream
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
INVESTOR_PROFILE_SNAPSHOT_CREATED   (InvestorProfileSnapshot:INSERT)
INVESTOR_PROFILE_SNAPSHOT_UPDATED   (InvestorProfileSnapshot:MODIFY)
MARKET_SNAPSHOT_UPDATED             (MarketSnapshot:MODIFY; INSERT collapses to UPDATED for simpler consumer logic)
MARKET_SNAPSHOT_REFRESH_TICK        (EventBridge schedule rule; published into advisoryBus; consumed by market-intelligence-ctrl Ingress only)
```

**Removed events:** `ANALYZE_INVESTOR_PROFILE`, `ANALYZE_MARKET` are no longer emitted by `decision-workflow-ctrl` and no longer subscribed by IP/MI ctrls. The constants are deleted from `DecisionWorkflowEventTypes` in the same ship.

**Retained:** All 7 trigger events, all downstream agent events (PORTFOLIO_*, NARRATIVE_*, DECISION_*) unchanged.

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
  InvokePortfolioEngine (waitForTaskToken; unchanged)
  │
  InvokeAdvisoryNarrative (waitForTaskToken; unchanged)
  │
  AssembleDecisionPacket (lambda:invoke; unchanged)
  │
  WaitForCompliance → ComplianceChoice → … (unchanged)
```

Latency contribution from "Phase 1" drops from 5–30 s (two agent calls) to <100 ms (two DDB GetItems + zero or two Pass states). Per-cycle agent count drops from 4 to 2.

## E2E fixture impact

- **`onboarded()`** (`apps/e2e-feature-tests/src/helpers/fixtures.ts:64–113`) — chain already produces an `INVESTOR_PROFILE_UPDATED` via the `ONBOARDING_COMPLETED → composite InvestorProfile row → CDC` path. Post-change, this also drives `investor-profile-ctrl` to materialise the first `InvestorProfileSnapshot`. Add a DDB-poll for `InvestorProfileSnapshot#{tenantId}#{userId}` existence before returning, mirroring the `CashBalance` pattern in `funded()` (`fixtures.ts:140–152`).
- **`withLiveDecision()`** (`fixtures.ts:213–298`) — outward shape unchanged. Faster cycle (no per-cycle IP+MI agent calls), so `timeoutMs` default drops from 180 s → 90 s as a starting estimate. Update after measuring on dev.
- **`MarketSnapshot` seeding** — fresh dev environment needs a bootstrap. Add a one-time backfill at the end of `infrastructure/scripts/deploy.sh` that publishes one synthetic feed event per region, blocking until the snapshot materialises. Without it, the first cycle on a freshly-deployed environment sees an empty `MarketSnapshot` GetItem and PE receives empty `marketAnalysis`.

## Testing

### Unit

- `investor-profile-ctrl`: add handler tests for the three new ingress event types. Each follows the existing `ANALYZE_INVESTOR_PROFILE` test shape — different trigger envelope, same agent invocation, asserts an `InvestorProfileSnapshot` write intent. Delete the `ANALYZE_INVESTOR_PROFILE` handler test.
- `market-intelligence-ctrl`: add handler tests for each of the 5 feed events (fast-tier merge) plus `MARKET_SNAPSHOT_REFRESH_TICK` (slow-tier rebuild). Delete the `ANALYZE_MARKET` handler test.
- `decision-workflow-ctrl`: add SF-state assertion tests for the new Choice + GetItem states. Cover both Choice branches (payload-present vs payload-absent) for IP and Mandate.

### Integration

- `investor-profile-ctrl/test/integration/`: scenario "snapshot materialised on profile update" — publish `INVESTOR_PROFILE_UPDATED`, poll for `InvestorProfileSnapshot` row, assert `agentOutput` shape matches schema.
- `market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`: extend with "fast-tier merge on feed event" + "slow-tier rebuild on schedule" scenarios. Idempotency: replay the same feed event id, assert single agent run.
- `decision-workflow-ctrl/test/integration/`: add SF-execution scenario asserting the payload-first Choice branches behave correctly. Use a synthetic `INVESTOR_PROFILE_UPDATED` trigger with operatingMode='AGGRESSIVE' inline, but write `BALANCED` to the projection — assert PE receives `AGGRESSIVE`.

### E2E

- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (scenario 11) — expected to drop from 180 s window to ~60 s. Pass/fail criterion unchanged.
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (scenario 12) — same. The proposal's "may unblock 11+12 alone" claim becomes a measurable outcome of this ship.

## Rollback

Single revert commit on the implementation PR. Snapshot tables and CDC events become orphaned in dev (purge on next deploy). SF state machine reverts to the current 4-agent parallel+sequential shape. No data migration needed (dev is disposable).

## Validation gate

The implementation workstream's `validation_gate` is satisfied when all of:

1. `pnpm nx affected -t test,lint --base=origin/main` green
2. `pnpm nx affected -t test-integration --base=origin/main` green (`investor-profile-ctrl`, `market-intelligence-ctrl`, `decision-workflow-ctrl`)
3. Dev deploy of `investor-profile-ctrl`, `market-intelligence-ctrl`, `decision-workflow-ctrl` completes via `infrastructure/scripts/deploy.sh sandbox --prefix=dev`
4. E2E scenarios `first-decision` + `rebalance-on-drift` pass on dev (single targeted run each)
5. CloudWatch Logs Insights confirms zero `ANALYZE_INVESTOR_PROFILE` / `ANALYZE_MARKET` events on advisoryBus over a 30-min window post-ship
6. CloudWatch shows non-zero `INVESTOR_PROFILE_SNAPSHOT_CREATED` and `MARKET_SNAPSHOT_UPDATED` event volume in the same window

## Open questions deferred to the plan phase

- Exact SSM parameter wiring for `MARKET_SNAPSHOT_REFRESH_TICK` schedule rate (15-min hardcoded vs SSM-tunable).
- Whether the deploy-script feed-event bootstrap should be a backfill Lambda, a CDK custom resource, or a manual one-time step.
- Whether `InvestorProfileSnapshot` should retain agent-tracing fields (token counts, model id, latency) for observability parity with today's `AgentInvocation` row.

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
