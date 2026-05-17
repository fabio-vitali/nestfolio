# Advisory Cycle — Agent Precomputation + Callback Symmetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `investor-profile-ctrl` and `market-intelligence-ctrl` out of the per-cycle SF pipeline (continuous projection on upstream events), refactor `portfolio-engine-ctrl` and `advisory-narrative-ctrl` to emit `*_COMPLETED`/`*_FAILED` events via CDC instead of calling `states:SendTaskSuccess` directly, and rewire the SF to read projections (with payload-first Choice states for IP + Mandate). After this lands, `decision-workflow-ctrl-CallbackIngress` is the sole caller of `states:SendTaskSuccess`/`SendTaskFailure` in the system.

**Architecture:** IP-ctrl and MI-ctrl own their canonical snapshot rows; DWC gains a `SnapshotProjectorIngress` that mirrors them locally so the SF reads only from DWC-owned DDB rows (no cross-service IAM grants). PE+AN replace `resumeStateMachine` with the standard `ingressPipeline` and emit `AgentCompletion`/`AgentFailure` rows whose CDC publishes the `*_COMPLETED`/`*_FAILED` events that the existing `CallbackIngress` already subscribes to.

**Tech Stack:** TypeScript, AWS CDK, Step Functions (CustomState ASL), EventBridge, DynamoDB Streams, Lambda, Bedrock AgentCore, Jest, `@nestfolio/event-processor` (`materializeToTable`, `resumeStateMachine`, `record`, `update`), `@nestfolio/cdk-constructs` (State, Ingress, Egress, Orchestration), `@nestfolio/agent-orchestrator`.

**Spec:** `docs/superpowers/specs/2026-05-17-advisory-cycle-agent-precomputation-design.md`
**Backlog:** `docs/backlog/advisory-cycle-agent-precomputation-impl.md`

---

## Task 1: Domain types and event constants (foundation, compile-only)

Lay down the new types and event constants across all five services without changing any handler behavior. Subsequent tasks reference these.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/domain/models.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/domain/events.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/models.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/events.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/models.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/events.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/models.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/models.ts`

- [ ] **Step 1: Add InvestorProfileSnapshot type and event constants in investor-profile-ctrl**

`services/advisory/investor-profile-ctrl/src/domain/models.ts` — append:

```typescript
export interface InvestorProfileSnapshotRow {
  pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  sk: 'InvestorProfileSnapshot';
  __typename: 'InvestorProfileSnapshot';
  tenantId: string;
  userId: string;
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
  sourceEventId: string;
  sourceEventType: 'INVESTOR_PROFILE_UPDATED' | 'MANDATE_ISSUED' | 'OPERATING_MODE_CHANGED';
  agentInvocationId: string;
  updatedAt: string;
}
```

`services/advisory/investor-profile-ctrl/src/domain/events.ts` — add to `InvestorProfileEventTypes` const:

```typescript
INVESTOR_PROFILE_SNAPSHOT_CREATED: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
INVESTOR_PROFILE_SNAPSHOT_UPDATED: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
```

Also add to `HANDLED_EVENT_TYPES` const (will be wired in Task 2 service stack):

```typescript
export const HANDLED_EVENT_TYPES = [
  'INVESTOR_PROFILE_UPDATED',
  'MANDATE_ISSUED',
  'OPERATING_MODE_CHANGED',
] as const;
```

Do NOT remove `ANALYZE_INVESTOR_PROFILE` or `INVESTOR_PROFILE_COMPLETED` constants in this task — they're consumed elsewhere until Task 9. Leave them defined but unused for now.

- [ ] **Step 2: Add MarketSnapshot type and event constants in market-intelligence-ctrl**

`services/advisory/market-intelligence-ctrl/src/domain/models.ts` — append:

```typescript
export interface MarketSnapshotRow {
  pk: string;                              // `MarketSnapshot#${region}`
  sk: 'MarketSnapshot';
  __typename: 'MarketSnapshot';
  region: string;
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
  fastComponentsAt: string;
  slowComponentsAt: string;
  sourceEventIds: string[];                // ring buffer, last 20
  updatedAt: string;
}
```

`services/advisory/market-intelligence-ctrl/src/domain/events.ts` — add to `MarketIntelligenceEventTypes` const:

```typescript
MARKET_SNAPSHOT_UPDATED: 'MARKET_SNAPSHOT_UPDATED',
MARKET_SNAPSHOT_REFRESH_TICK: 'MARKET_SNAPSHOT_REFRESH_TICK',
```

Update `HANDLED_EVENT_TYPES`:

```typescript
export const HANDLED_EVENT_TYPES = [
  // 5 existing feed events stay
  'YAHOO_FINANCE_UPDATED',
  'MARKETWATCH_UPDATED',
  'SEC_8K_FILED',
  'FRED_INDICATORS_UPDATED',
  'ALPHA_VANTAGE_NEWS_UPDATED',
  'MARKET_SNAPSHOT_REFRESH_TICK',
] as const;
```

Leave `ANALYZE_MARKET` and `MARKET_ANALYSIS_COMPLETED` defined for now (removed in Task 9).

- [ ] **Step 3: Add AgentCompletion + AgentFailure + PORTFOLIO_FAILED in portfolio-engine-ctrl**

`services/advisory/portfolio-engine-ctrl/src/domain/models.ts` — append:

```typescript
export interface AgentCompletionRow {
  pk: string;                              // `AgentCompletion#${decisionId}`
  sk: string;                              // `AgentCompletion#${agentName}`
  __typename: 'AgentCompletion';
  decisionId: string;
  tenantId: string;
  agentName: 'portfolio-engine';
  taskToken: string;
  agentOutput: Record<string, unknown>;
  completedAt: string;
}

export interface AgentFailureRow {
  pk: string;                              // `AgentFailure#${decisionId}`
  sk: string;                              // `AgentFailure#${agentName}`
  __typename: 'AgentFailure';
  decisionId: string;
  tenantId: string;
  agentName: 'portfolio-engine';
  taskToken: string;
  errorType: string;
  errorMessage: string;
  failedAt: string;
}
```

`services/advisory/portfolio-engine-ctrl/src/domain/events.ts` — add to `PortfolioEngineEventTypes` const:

```typescript
PORTFOLIO_FAILED: 'PORTFOLIO_FAILED',
```

`PORTFOLIO_COMPLETED` already exists per `services/advisory/decision-workflow-ctrl/CLAUDE.md` agent-completion list — leave it defined and unused; Task 4 wires it.

- [ ] **Step 4: Add AgentCompletion + AgentFailure + NARRATIVE_FAILED in advisory-narrative-ctrl**

Mirror Step 3 in `services/advisory/advisory-narrative-ctrl/src/domain/models.ts` with `agentName: 'advisory-narrative'`.

`services/advisory/advisory-narrative-ctrl/src/domain/events.ts` — add:

```typescript
NARRATIVE_FAILED: 'NARRATIVE_FAILED',
```

- [ ] **Step 5: Add InvestorProfileSnapshot + MarketSnapshot projection types in decision-workflow-ctrl**

`services/advisory/decision-workflow-ctrl/src/domain/models.ts` — append. These are DWC's local projection copies. Shape mirrors the canonical types but lives in DWC's domain so DWC doesn't take a runtime import on IP/MI ctrl source.

```typescript
export interface InvestorProfileSnapshotProjectionRow {
  pk: string;                              // `InvestorProfileSnapshot#${tenantId}#${userId}`
  sk: 'InvestorProfileSnapshot';
  __typename: 'InvestorProfileSnapshot';
  tenantId: string;
  userId: string;
  agentOutput: Record<string, unknown>;    // opaque from DWC's POV
  sourceEventId: string;
  updatedAt: string;
}

export interface MarketSnapshotProjectionRow {
  pk: string;                              // `MarketSnapshot#${region}`
  sk: 'MarketSnapshot';
  __typename: 'MarketSnapshot';
  region: string;
  agentOutput: Record<string, unknown>;
  updatedAt: string;
}
```

- [ ] **Step 6: Run typecheck across affected projects**

```bash
pnpm nx run-many -t typecheck \
  --projects=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl
```

Expected: PASS (no semantic changes, only additions).

- [ ] **Step 7: Commit**

```bash
git add services/advisory/{investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl}/src/domain/
git commit -m "feat(advisory): domain types + event constants for precomputation + callback refactor"
```

---

## Task 2: investor-profile-ctrl — handler rewrite for precomputation

Switch IP-ctrl's Ingress handler from `resumeStateMachine` (returns SendTaskSuccess) to the standard `ingressPipeline` (writes `InvestorProfileSnapshot` row via `record()`). Three handlers for the three new trigger types.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/investor-profile-ctrl/src/repositories/investor-profile-snapshot.repository.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write the failing tests for the three new handlers**

Replace the existing `ANALYZE_INVESTOR_PROFILE` test block in `test/unit/event-listener.test.ts` with one describe block per new handler. Reference test shape — the existing test is one block away from this and uses the same harness:

```typescript
describe('INVESTOR_PROFILE_UPDATED handler', () => {
  it('runs the agent and emits an InvestorProfileSnapshot write intent', async () => {
    const agentService = { runPipeline: jest.fn().mockResolvedValue({
      goals: ['retirement'], timeHorizon: '10+ years', riskWillingness: 'moderate',
      riskScore: 55, riskCategory: 'MODERATE', regulatoryFlags: [],
      suitabilityAssessment: 'OK', confidence: 0.88,
    })};
    const memoryClient = createNoOpMemoryClient();
    const handlers = createHandlers({ agentService, memoryClient });

    const result = await handlers.INVESTOR_PROFILE_UPDATED(
      { subject: { tenantId: 't1', userId: 'u1', operatingMode: 'BALANCED', goal: {}, riskProfile: {} } },
      { eventId: 'e1', eventType: 'INVESTOR_PROFILE_UPDATED', tenantId: 't1' },
    );

    expect(agentService.runPipeline).toHaveBeenCalledWith('e1', expect.objectContaining({ tenantId: 't1', operatingMode: 'BALANCED' }));
    expect(result.intents).toEqual([
      expect.objectContaining({ kind: 'record', typeName: 'AgentInvocation' }),
      expect.objectContaining({
        kind: 'record',
        typeName: 'InvestorProfileSnapshot',
        attributes: expect.objectContaining({
          tenantId: 't1', userId: 'u1',
          sourceEventType: 'INVESTOR_PROFILE_UPDATED',
          sourceEventId: 'e1',
        }),
      }),
    ]);
  });

  it('throws UnknownOperatingModeError when operatingMode is absent', async () => {
    const handlers = createHandlers({ agentService: { runPipeline: jest.fn() }, memoryClient: createNoOpMemoryClient() });
    await expect(
      handlers.INVESTOR_PROFILE_UPDATED(
        { subject: { tenantId: 't1', userId: 'u1' } },
        { eventId: 'e1', eventType: 'INVESTOR_PROFILE_UPDATED', tenantId: 't1' },
      ),
    ).rejects.toThrow(UnknownOperatingModeError);
  });
});

describe('MANDATE_ISSUED handler', () => {
  it('runs the agent and emits an InvestorProfileSnapshot write intent with sourceEventType=MANDATE_ISSUED', async () => {
    // same shape as above, different sourceEventType
  });
});

describe('OPERATING_MODE_CHANGED handler', () => {
  it('runs the agent and emits an InvestorProfileSnapshot write intent with sourceEventType=OPERATING_MODE_CHANGED', async () => {
    // same shape as above
  });
});
```

Remove the existing `ANALYZE_INVESTOR_PROFILE` describe block.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx test investor-profile-ctrl
```

Expected: FAIL — `INVESTOR_PROFILE_UPDATED` is not a handler key on the returned object.

- [ ] **Step 3: Create the snapshot repository**

`services/advisory/investor-profile-ctrl/src/repositories/investor-profile-snapshot.repository.ts`:

```typescript
export const INVESTOR_PROFILE_SNAPSHOT_SK = 'InvestorProfileSnapshot' as const;

export function investorProfileSnapshotPk(tenantId: string, userId: string): string {
  return `InvestorProfileSnapshot#${tenantId}#${userId}`;
}
```

(Keep the repository file thin — `record()` / `update()` from event-processor handle the SDK calls. This file exists only to centralise the key formula.)

- [ ] **Step 4: Rewrite event-listener.ts to ingressPipeline**

Replace the entire file with the new handler shape. The diff vs today is:
1. Import `materializeToTable` instead of `resumeStateMachine` (we're writing rows, not resuming SF).
2. Replace the single `ANALYZE_INVESTOR_PROFILE` handler with three new ones.
3. Each handler returns `record('AgentInvocation', ...)` + `record('InvestorProfileSnapshot', ...)` intents — no `output.agentOutput` / `output.operatingMode` (no SF callback to feed).

Full rewrite:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  type EventPayload,
  type EventContext,
  type WriteIntent,
  requireEnv,
  logger,
} from '@nestfolio/event-processor';
import {
  createMemoryClient,
  createNoOpMemoryClient,
  type MemoryClient,
  UnknownOperatingModeError,
} from '@nestfolio/agent-orchestrator';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  investorProfileSnapshotPk,
  INVESTOR_PROFILE_SNAPSHOT_SK,
} from '../repositories/investor-profile-snapshot.repository';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
}

type SourceEventType =
  | 'INVESTOR_PROFILE_UPDATED'
  | 'MANDATE_ISSUED'
  | 'OPERATING_MODE_CHANGED';

async function runSnapshotAgent(
  deps: IngressDeps,
  payload: EventPayload,
  ctx: EventContext,
  sourceEventType: SourceEventType,
): Promise<{ output: Record<string, unknown>; intents: WriteIntent[] } | { output: Record<string, unknown> }> {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = (subject.operatingMode as string | undefined)
    ?? ((subject.mandate as Record<string, unknown> | undefined)?.operatingMode as string | undefined);

  if (!operatingMode) {
    throw new UnknownOperatingModeError({
      decisionId: `snapshot:${sourceEventType}:${tenantId}:${userId}`,
      resolutionPath: 'subject.operatingMode || subject.mandate.operatingMode',
      availableKeys: Object.keys(subject),
    });
  }

  logger.info(`Processing ${sourceEventType} for snapshot rebuild`, { tenantId, userId });

  const session = deps.memoryClient.openDecisionSession(tenantId, `snapshot-${ctx.eventId}`);
  const tenantHistory = await session.searchLongTermMemory('preferences', 'investor preferences risk tolerance');

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, {
      tenantId,
      decisionId: `snapshot-${ctx.eventId}`,
      operatingMode,
      investorProfile: subject,
      portfolioState: {},
      tenantHistory: tenantHistory.map(r => r.content),
    });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info(`Duplicate ${sourceEventType} event, skipping`, { eventId: ctx.eventId });
      return { output: { tenantId, userId, deduplicated: true } };
    }
    throw error;
  }

  return {
    output: { tenantId, userId, sourceEventType },
    intents: [
      record('AgentInvocation', { decisionId: `snapshot-${ctx.eventId}`, tenantId, agentName: 'investor-profile' }),
      record('InvestorProfileSnapshot', {
        tenantId,
        userId,
        agentOutput: result,
        sourceEventId: ctx.eventId,
        sourceEventType,
        agentInvocationId: ctx.eventId,
      }, { pk: investorProfileSnapshotPk(tenantId, userId), sk: INVESTOR_PROFILE_SNAPSHOT_SK }),
    ],
  };
}

export const createHandlers = (deps: IngressDeps) => ({
  INVESTOR_PROFILE_UPDATED: (p: EventPayload, c: EventContext) => runSnapshotAgent(deps, p, c, 'INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED:           (p: EventPayload, c: EventContext) => runSnapshotAgent(deps, p, c, 'MANDATE_ISSUED'),
  OPERATING_MODE_CHANGED:   (p: EventPayload, c: EventContext) => runSnapshotAgent(deps, p, c, 'OPERATING_MODE_CHANGED'),
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'investor-profile' })
  : createNoOpMemoryClient();
const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });
const deps: IngressDeps = { agentService, memoryClient };

export const handler = materializeToTable({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm nx test investor-profile-ctrl
```

Expected: PASS for all three new handler describes plus the `UnknownOperatingModeError` case. Existing `agent-service.test.ts`, `graph.test.ts`, `kb-ingestion-handler.test.ts` stay green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts \
       services/advisory/investor-profile-ctrl/src/repositories/investor-profile-snapshot.repository.ts \
       services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts
git commit -m "feat(investor-profile-ctrl): switch ingress to snapshot writer (precomputation)"
```

---

## Task 3: investor-profile-ctrl — service stack rewiring

Switch subscriptions, add Egress mapping for the new snapshot row, drop `states:SendTaskSuccess`/`SendTaskFailure` grants.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Read current stack to confirm shape**

Open `services/advisory/investor-profile-ctrl/src/service.stack.ts`. Confirm it uses the standard 6-construct pattern with State + Ingress + Egress + AgentRuntime + (possibly) standalone KBIngestion Lambda. Note the existing Ingress subscription list and any IAM grants (specifically: look for `grantSendTaskSuccess` or equivalent — these come from `Orchestration.grantStartExecution` or per-Ingress IAM additions; the AgentCore Memory grant is separate).

- [ ] **Step 2: Write CDK snapshot test asserting the new subscriptions**

In `test/unit/service.stack.test.ts`, add or update an assertion:

```typescript
it('subscribes to INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, OPERATING_MODE_CHANGED — not ANALYZE_INVESTOR_PROFILE', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      'detail-type': Match.arrayWith(['INVESTOR_PROFILE_UPDATED', 'MANDATE_ISSUED', 'OPERATING_MODE_CHANGED']),
    }),
  });
  // Negative assertion: no rule subscribes to ANALYZE_INVESTOR_PROFILE
  const rules = template.findResources('AWS::Events::Rule');
  for (const rule of Object.values(rules)) {
    const detailTypes = rule.Properties?.EventPattern?.['detail-type'] ?? [];
    expect(detailTypes).not.toContain('ANALYZE_INVESTOR_PROFILE');
  }
});

it('does not grant states:SendTaskSuccess or states:SendTaskFailure to any role', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
    for (const stmt of statements) {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      expect(actions).not.toContain('states:SendTaskSuccess');
      expect(actions).not.toContain('states:SendTaskFailure');
    }
  }
});

it('emits INVESTOR_PROFILE_SNAPSHOT_CREATED on InvestorProfileSnapshot:INSERT and _UPDATED on MODIFY', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  // Egress construct declares CDC mappings via env var on the publisher Lambda.
  // Match the env var pattern used elsewhere in the codebase (e.g. compliance-ctrl test).
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: Match.objectLike({
      Variables: Match.objectLike({
        EVENT_TYPES_MAP: Match.stringLikeRegexp('InvestorProfileSnapshot'),
      }),
    }),
  });
});
```

- [ ] **Step 3: Run the new stack tests to verify they fail**

```bash
pnpm nx test investor-profile-ctrl --testPathPatterns=service.stack
```

Expected: FAIL — stack still subscribes to `ANALYZE_INVESTOR_PROFILE`, has no `InvestorProfileSnapshot` Egress mapping, and may still grant `states:*`.

- [ ] **Step 4: Update service.stack.ts**

Apply three edits:

1. **Ingress subscriptions** — change `eventTypes: [...]` on the Ingress construct to the three new types:

```typescript
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
    InvestorBffEventTypes.MANDATE_ISSUED,
    InvestorBffEventTypes.OPERATING_MODE_CHANGED,
  ],
});
```

2. **Egress** — declare CDC mapping for the new row type:

```typescript
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'AgentInvocation':            { insert: InvestorProfileEventTypes.GOAL_INTERPRETATION_PRODUCED },
    'ReasoningOutput':            { insert: InvestorProfileEventTypes.RISK_EVALUATION_PRODUCED },
    'InvestorProfileSnapshot':    {
      insert: InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED,
      modify: InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED,
    },
  },
});
```

3. **IAM** — remove any `states:SendTaskSuccess`/`SendTaskFailure` grants. The codebase typically grants these inside `Orchestration` consumers, not directly on the ingress Lambda. If you find a `grantSendTaskSuccess` or similar inline grant, delete it. The grant for AgentCore Memory + Bedrock stays.

- [ ] **Step 5: Run all unit tests for the service**

```bash
pnpm nx test investor-profile-ctrl
```

Expected: PASS (handler tests from Task 2 + stack tests from this task).

- [ ] **Step 6: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/service.stack.ts \
       services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(investor-profile-ctrl): rewire subscriptions + snapshot CDC + drop SF IAM"
```

---

## Task 4: market-intelligence-ctrl — handler rewrite + schedule tick

Switch MI-ctrl ingress to write `MarketSnapshot` from feed events (fast tier) and from a new `MARKET_SNAPSHOT_REFRESH_TICK` (slow tier).

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/market-intelligence-ctrl/src/repositories/market-snapshot.repository.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write failing tests for the new handlers**

```typescript
describe('MARKET_SNAPSHOT_REFRESH_TICK handler', () => {
  it('runs the slow-tier rebuild and emits MarketSnapshot write intent', async () => {
    const agentService = { runPipeline: jest.fn().mockResolvedValue({
      signals: [], tickersMentioned: [], marketOutlook: 'neutral', confidenceScore: 0.7,
    })};
    const handlers = createHandlers({ agentService, memoryClient: createNoOpMemoryClient() });

    const result = await handlers.MARKET_SNAPSHOT_REFRESH_TICK(
      { subject: { region: 'us-east-1' } },
      { eventId: 'tick-1', eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', tenantId: 'SYSTEM' },
    );

    expect(result.intents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'record',
        typeName: 'MarketSnapshot',
        attributes: expect.objectContaining({ region: 'us-east-1' }),
      }),
    ]));
  });
});

describe.each([
  ['YAHOO_FINANCE_UPDATED'],
  ['MARKETWATCH_UPDATED'],
  ['SEC_8K_FILED'],
  ['FRED_INDICATORS_UPDATED'],
  ['ALPHA_VANTAGE_NEWS_UPDATED'],
])('%s handler (fast-tier)', (eventType) => {
  it('runs the agent and emits MarketSnapshot write intent with fastComponentsAt set', async () => {
    const agentService = { runPipeline: jest.fn().mockResolvedValue({ signals: [], tickersMentioned: [], marketOutlook: '', confidenceScore: 0.8 }) };
    const handlers = createHandlers({ agentService, memoryClient: createNoOpMemoryClient() });
    const result = await handlers[eventType](
      { subject: { region: 'us-east-1' } },
      { eventId: `feed-${eventType}-1`, eventType, tenantId: 'SYSTEM' },
    );
    const snapshotIntent = result.intents.find((i: any) => i.typeName === 'MarketSnapshot');
    expect(snapshotIntent.attributes.fastComponentsAt).toBeDefined();
    expect(snapshotIntent.attributes.sourceEventIds).toContain(`feed-${eventType}-1`);
  });
});
```

Remove the existing `ANALYZE_MARKET` describe block.

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm nx test market-intelligence-ctrl
```

Expected: FAIL — handler keys not present.

- [ ] **Step 3: Create the snapshot repository**

`services/advisory/market-intelligence-ctrl/src/repositories/market-snapshot.repository.ts`:

```typescript
export const MARKET_SNAPSHOT_SK = 'MarketSnapshot' as const;

export function marketSnapshotPk(region: string): string {
  return `MarketSnapshot#${region}`;
}
```

- [ ] **Step 4: Rewrite event-listener.ts**

Replace the file. Six handlers (5 feed events + 1 scheduled tick) routed through a shared `runMarketAgent` helper. Distinguish fast vs slow tier by which `*At` field is set and whether `sourceEventIds` is appended.

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  update,
  type EventPayload,
  type EventContext,
  type WriteIntent,
  requireEnv,
  logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import { marketSnapshotPk, MARKET_SNAPSHOT_SK } from '../repositories/market-snapshot.repository';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
}

type Tier = 'fast' | 'slow';

async function runMarketAgent(
  deps: IngressDeps,
  payload: EventPayload,
  ctx: EventContext,
  tier: Tier,
): Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }> {
  const region = ((payload.subject ?? {}).region as string | undefined) ?? process.env.AWS_REGION ?? 'us-east-1';
  logger.info(`Processing ${ctx.eventType} for MarketSnapshot rebuild`, { region, tier });

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, { region, tier });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info(`Duplicate ${ctx.eventType}, skipping`, { eventId: ctx.eventId });
      return { output: { region, deduplicated: true } };
    }
    throw error;
  }

  const now = new Date().toISOString();
  const intents: WriteIntent[] = [
    record('AgentInvocation', { decisionId: `snapshot-${ctx.eventId}`, agentName: 'market-intelligence' }),
  ];

  if (tier === 'slow') {
    // Slow-tier rebuilds the row from scratch.
    intents.push(record('MarketSnapshot', {
      region,
      agentOutput: result,
      slowComponentsAt: now,
      fastComponentsAt: now,
      sourceEventIds: [ctx.eventId],
      updatedAt: now,
    }, { pk: marketSnapshotPk(region), sk: MARKET_SNAPSHOT_SK }));
  } else {
    // Fast-tier merges into the existing row. Use update() for partial patch.
    // The agent rerun gives us a full agentOutput; we overwrite that and bump fastComponentsAt.
    // sourceEventIds is append-only ring buffer (last 20) — implementation detail of update()
    // depends on the event-processor API; if it doesn't support list-append natively, fall back
    // to record() with put-overwrite and accept that older IDs are dropped per rebuild.
    intents.push(update('MarketSnapshot', {
      region,
      agentOutput: result,
      fastComponentsAt: now,
      updatedAt: now,
      sourceEventIds: [ctx.eventId],     // see Open Question in plan footer
    }, { overrides: { pk: marketSnapshotPk(region), sk: MARKET_SNAPSHOT_SK } }));
  }

  return { output: { region, tier }, intents };
}

export const createHandlers = (deps: IngressDeps) => ({
  YAHOO_FINANCE_UPDATED:        (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  MARKETWATCH_UPDATED:          (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  SEC_8K_FILED:                 (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  FRED_INDICATORS_UPDATED:      (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  ALPHA_VANTAGE_NEWS_UPDATED:   (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  MARKET_SNAPSHOT_REFRESH_TICK: (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'slow'),
});

// Production wiring as before (memoryClient, agentService, materializeToTable).
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'market-intelligence' })
  : createNoOpMemoryClient();
const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });
const deps: IngressDeps = { agentService, memoryClient };

export const handler = materializeToTable({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
pnpm nx test market-intelligence-ctrl
```

Expected: PASS for all six handlers + parametrised feed-event describe.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts \
       services/advisory/market-intelligence-ctrl/src/repositories/market-snapshot.repository.ts \
       services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts
git commit -m "feat(market-intelligence-ctrl): snapshot writer with fast/slow tiers"
```

---

## Task 5: market-intelligence-ctrl — service stack + schedule rule

Drop `ANALYZE_MARKET` subscription, add `MARKET_SNAPSHOT_REFRESH_TICK` schedule rule, add `MarketSnapshot` Egress mapping, drop `states:*` grants.

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write stack tests**

```typescript
it('subscribes to 5 feed events plus MARKET_SNAPSHOT_REFRESH_TICK, not ANALYZE_MARKET', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      'detail-type': Match.arrayWith([
        'YAHOO_FINANCE_UPDATED',
        'MARKETWATCH_UPDATED',
        'SEC_8K_FILED',
        'FRED_INDICATORS_UPDATED',
        'ALPHA_VANTAGE_NEWS_UPDATED',
        'MARKET_SNAPSHOT_REFRESH_TICK',
      ]),
    }),
  });
  // Negative
  const rules = template.findResources('AWS::Events::Rule');
  for (const rule of Object.values(rules)) {
    const detailTypes = rule.Properties?.EventPattern?.['detail-type'] ?? [];
    expect(detailTypes).not.toContain('ANALYZE_MARKET');
  }
});

it('declares a scheduled rule with rate(15 minutes) targeting the advisoryBus', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(15 minutes)',
  });
});

it('emits MARKET_SNAPSHOT_UPDATED on MarketSnapshot row INSERT or MODIFY', () => {
  // Mirror the equivalent IP-ctrl test
});

it('does not grant states:SendTaskSuccess or states:SendTaskFailure', () => {
  // Same shape as IP-ctrl Task 3 test
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm nx test market-intelligence-ctrl --testPathPatterns=service.stack
```

Expected: FAIL.

- [ ] **Step 3: Update service.stack.ts**

1. **Ingress subscriptions** — keep the 5 feed events (already subscribed for KB), add `MARKET_SNAPSHOT_REFRESH_TICK`, remove `ANALYZE_MARKET`:

```typescript
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    MarketIntelligenceEventTypes.YAHOO_FINANCE_UPDATED,
    MarketIntelligenceEventTypes.MARKETWATCH_UPDATED,
    MarketIntelligenceEventTypes.SEC_8K_FILED,
    MarketIntelligenceEventTypes.FRED_INDICATORS_UPDATED,
    MarketIntelligenceEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
    MarketIntelligenceEventTypes.MARKET_SNAPSHOT_REFRESH_TICK,
  ],
});
```

2. **Schedule rule** — new EventBridge schedule that publishes `MARKET_SNAPSHOT_REFRESH_TICK` onto the advisoryBus. Use the existing `cdk-constructs/extensions` helper if one exists, otherwise inline the rule:

```typescript
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Duration } from 'aws-cdk-lib';

new Rule(this, 'MarketSnapshotRefreshTick', {
  schedule: Schedule.rate(Duration.minutes(15)),
  targets: [new EventBusTarget(this.eventBus, {
    deadLetterQueue: undefined,
    event: RuleTargetInput.fromObject({
      id: 'States.UUID()',                // not strictly valid here; use a Lambda-bridge if schedule needs structured detail
      type: 'MARKET_SNAPSHOT_REFRESH_TICK',
      source: 'market-intelligence-ctrl',
      subject: { region: 'us-east-1' },
      context: { tenantId: 'SYSTEM', userId: 'SYSTEM', region: 'us-east-1' },
    }),
  })],
});
```

NOTE: EventBridge cross-bus scheduled-rule targets do not natively support all CDK-construct detail shapes. If `EventBusTarget` can't produce a fully-formed event-processor envelope, fall back to a small `scheduled-emitter` Lambda target that calls `PutEvents`. Decide during implementation; the test in Step 1 only asserts the rate, not the envelope.

3. **Egress** — add `MarketSnapshot` mapping:

```typescript
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'AgentInvocation': { insert: MarketIntelligenceEventTypes.MARKET_SIGNAL_DETECTED },
    'MarketSnapshot':  {
      insert: MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED,
      modify: MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED,
    },
  },
});
```

4. **IAM** — remove any `states:*` grants.

- [ ] **Step 4: Run all tests for the service**

```bash
pnpm nx test market-intelligence-ctrl
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/service.stack.ts \
       services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(market-intelligence-ctrl): schedule tick + snapshot CDC + drop SF IAM"
```

---

## Task 6: portfolio-engine-ctrl — callback refactor

Switch `event-listener.ts` from `resumeStateMachine` (calls `SendTaskSuccess` inside the Lambda) to `materializeToTable` (writes `AgentCompletion` / `AgentFailure` rows). CDC will emit `PORTFOLIO_COMPLETED` / `PORTFOLIO_FAILED` which `CallbackIngress` (Task 10) resumes.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/portfolio-engine-ctrl/src/repositories/agent-completion.repository.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write failing handler tests**

```typescript
describe('CONSTRUCT_PORTFOLIO handler', () => {
  it('on success: emits AgentInvocation + AgentCompletion with taskToken on intents', async () => {
    const agentService = { runPipeline: jest.fn().mockResolvedValue({ allocations: { allocations: [], totalExposure: 1.0 } }) };
    const handlers = createHandlers({ agentService, memoryClient: createNoOpMemoryClient(), kbIngestionHandler: { ingest: jest.fn() } });

    const result = await handlers.CONSTRUCT_PORTFOLIO(
      { subject: { tenantId: 't1', decisionId: 'd1', operatingMode: 'BALANCED', taskToken: 'token-abc', investorProfile: {}, marketAnalysis: {} } },
      { eventId: 'e1', eventType: 'CONSTRUCT_PORTFOLIO', tenantId: 't1' },
    );

    expect(result.intents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'record', typeName: 'AgentInvocation',
        attributes: expect.objectContaining({ decisionId: 'd1', agentName: 'portfolio-engine' }),
      }),
      expect.objectContaining({
        kind: 'record', typeName: 'AgentCompletion',
        attributes: expect.objectContaining({
          decisionId: 'd1', taskToken: 'token-abc', agentName: 'portfolio-engine',
          agentOutput: expect.objectContaining({ allocations: expect.anything() }),
        }),
      }),
    ]));
  });

  it('on agent error: emits AgentFailure with taskToken, does NOT rethrow', async () => {
    const agentService = { runPipeline: jest.fn().mockRejectedValue(new Error('Bedrock throttle')) };
    const handlers = createHandlers({ agentService, memoryClient: createNoOpMemoryClient(), kbIngestionHandler: { ingest: jest.fn() } });

    const result = await handlers.CONSTRUCT_PORTFOLIO(
      { subject: { tenantId: 't1', decisionId: 'd1', operatingMode: 'BALANCED', taskToken: 'token-abc' } },
      { eventId: 'e1', eventType: 'CONSTRUCT_PORTFOLIO', tenantId: 't1' },
    );

    expect(result.intents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'record', typeName: 'AgentFailure',
        attributes: expect.objectContaining({
          decisionId: 'd1', taskToken: 'token-abc',
          errorType: 'Error', errorMessage: 'Bedrock throttle',
        }),
      }),
    ]));
  });

  it('throws if taskToken is missing on subject', async () => {
    const handlers = createHandlers({ agentService: { runPipeline: jest.fn() }, memoryClient: createNoOpMemoryClient(), kbIngestionHandler: { ingest: jest.fn() } });
    await expect(handlers.CONSTRUCT_PORTFOLIO(
      { subject: { tenantId: 't1', decisionId: 'd1', operatingMode: 'BALANCED' } },
      { eventId: 'e1', eventType: 'CONSTRUCT_PORTFOLIO', tenantId: 't1' },
    )).rejects.toThrow(/taskToken/);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

```bash
pnpm nx test portfolio-engine-ctrl
```

Expected: FAIL — handler doesn't return `AgentCompletion` intents yet.

- [ ] **Step 3: Create repository helpers**

`services/advisory/portfolio-engine-ctrl/src/repositories/agent-completion.repository.ts`:

```typescript
export const AGENT_COMPLETION_PK = (decisionId: string) => `AgentCompletion#${decisionId}`;
export const AGENT_COMPLETION_SK = (agentName: string) => `AgentCompletion#${agentName}`;

export const AGENT_FAILURE_PK = (decisionId: string) => `AgentFailure#${decisionId}`;
export const AGENT_FAILURE_SK = (agentName: string) => `AgentFailure#${agentName}`;
```

- [ ] **Step 4: Rewrite event-listener.ts**

Replace `resumeStateMachine` wiring with `materializeToTable`. Handler emits `AgentCompletion` (success) or `AgentFailure` (caught error). NotRetryableError for missing taskToken.

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  NotRetryableError,
  type EventPayload, type EventContext, type WriteIntent,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError } from '@nestfolio/agent-orchestrator';
import { KB_INGESTION_EVENT_TYPES } from '../domain';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  AGENT_COMPLETION_PK, AGENT_COMPLETION_SK,
  AGENT_FAILURE_PK, AGENT_FAILURE_SK,
} from '../repositories/agent-completion.repository';

const AGENT_NAME = 'portfolio-engine';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>, eventType: string) => Promise<void> };
}

export const createHandlers = (deps: IngressDeps) => {
  const handlers: Record<string, (p: EventPayload, c: EventContext) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>> = {
    CONSTRUCT_PORTFOLIO: async (payload, ctx) => {
      const subject = payload.subject ?? {};
      const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
      const decisionId = subject.decisionId as string;
      const taskToken = subject.taskToken as string | undefined;
      const operatingMode = subject.operatingMode as string | undefined;

      if (!taskToken) {
        throw new NotRetryableError(`CONSTRUCT_PORTFOLIO missing subject.taskToken for decisionId=${decisionId}`);
      }
      if (!operatingMode) {
        throw new UnknownOperatingModeError({
          decisionId,
          resolutionPath: 'subject.operatingMode (propagated by SF from InvokeInvestorProfile result)',
          availableKeys: Object.keys(subject),
        });
      }

      const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
      const pastRationale = await session.searchLongTermMemory('rationale', 'allocation rationale decisions');

      const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
      const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};

      try {
        const result = await deps.agentService.runPipeline(ctx.eventId, {
          tenantId, decisionId, operatingMode, investorProfile, marketAnalysis,
          pastRationale: pastRationale.map(r => r.content),
        });

        return {
          output: { decisionId, tenantId, agentOutput: result },
          intents: [
            record('AgentInvocation', { decisionId, tenantId, agentName: AGENT_NAME }),
            record('AgentCompletion', {
              decisionId, tenantId, agentName: AGENT_NAME,
              taskToken, agentOutput: result,
              completedAt: new Date().toISOString(),
            }, { pk: AGENT_COMPLETION_PK(decisionId), sk: AGENT_COMPLETION_SK(AGENT_NAME) }),
          ],
        };
      } catch (err) {
        if (err instanceof DuplicateInvocationError) {
          logger.info('Duplicate CONSTRUCT_PORTFOLIO, skipping', { eventId: ctx.eventId, decisionId });
          return { output: { decisionId, tenantId, deduplicated: true } };
        }
        const error = err as Error;
        logger.error('Agent run failed; emitting AgentFailure', { decisionId, errorType: error.name, errorMessage: error.message });
        return {
          output: { decisionId, tenantId, failed: true },
          intents: [
            record('AgentFailure', {
              decisionId, tenantId, agentName: AGENT_NAME,
              taskToken, errorType: error.name ?? 'UnknownError', errorMessage: error.message,
              failedAt: new Date().toISOString(),
            }, { pk: AGENT_FAILURE_PK(decisionId), sk: AGENT_FAILURE_SK(AGENT_NAME) }),
          ],
        };
        // No re-throw: failure is delivered via event, not via SQS-retry/DLQ. SQS-retry would re-invoke
        // the agent on the same task token, which is wrong — let CallbackIngress decide retry policy.
      }
    },
  };

  for (const eventType of KB_INGESTION_EVENT_TYPES) {
    handlers[eventType] = async (payload, ctx) => {
      await deps.kbIngestionHandler.ingest({ type: ctx.eventType, subject: payload.subject } as Record<string, unknown>, ctx.eventType);
      return { output: { eventType: ctx.eventType, status: 'ingested' } };
    };
  }

  return handlers;
};

// --- Production wiring ---
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: AGENT_NAME })
  : createNoOpMemoryClient();
const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });
const kbIngestionHandler = {
  ingest: async (_event: Record<string, unknown>, _eventType: string) => { /* delegated */ },
};
const deps: IngressDeps = { agentService, memoryClient, kbIngestionHandler };

export const handler = materializeToTable({
  serviceName: 'portfolio-engine-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED',
});
```

- [ ] **Step 5: Update Egress mapping in service.stack.ts**

```typescript
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'AgentInvocation':  { insert: PortfolioEngineEventTypes.PORTFOLIO_CONSTRUCTION_PROPOSED },
    'ReasoningOutput':  { insert: PortfolioEngineEventTypes.REBALANCE_PLAN_PRODUCED },
    'AgentCompletion':  { insert: PortfolioEngineEventTypes.PORTFOLIO_COMPLETED },
    'AgentFailure':     { insert: PortfolioEngineEventTypes.PORTFOLIO_FAILED },
  },
});
```

Also remove any `states:SendTaskSuccess` / `states:SendTaskFailure` IAM grants from this stack.

- [ ] **Step 6: Add stack test for IAM negation + new CDC mapping**

In `test/unit/service.stack.test.ts` — same shape as the IP-ctrl Task 3 tests but for AgentCompletion/AgentFailure.

- [ ] **Step 7: Run all PE tests**

```bash
pnpm nx test portfolio-engine-ctrl
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/
git commit -m "feat(portfolio-engine-ctrl): emit AgentCompletion/Failure via CDC (callback refactor)"
```

---

## Task 7: advisory-narrative-ctrl — callback refactor

Mirror Task 6 for `advisory-narrative-ctrl`. Identical pattern with `agentName: 'advisory-narrative'`, `GENERATE_NARRATIVE` ingress event, and `NARRATIVE_COMPLETED`/`NARRATIVE_FAILED` Egress mappings. The existing `DECISION_FEEDBACK` handler stays untouched (it doesn't resume SF; it processes feedback).

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`
- Create: `services/advisory/advisory-narrative-ctrl/src/repositories/agent-completion.repository.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write failing handler tests**

Same shape as Task 6 Step 1 but: `GENERATE_NARRATIVE` handler, `agentName: 'advisory-narrative'`, agentOutput shape `{ explainability: { rationale: '...' } }`.

- [ ] **Step 2: Run tests, verify fail**

```bash
pnpm nx test advisory-narrative-ctrl
```

- [ ] **Step 3: Create repository helpers**

`services/advisory/advisory-narrative-ctrl/src/repositories/agent-completion.repository.ts` — identical to PE's file.

- [ ] **Step 4: Rewrite event-listener.ts**

Same structure as PE's rewrite. Differences:
- `AGENT_NAME = 'advisory-narrative'`
- Handler name: `GENERATE_NARRATIVE`
- Includes the `DECISION_FEEDBACK` handler (preserved from current file, unchanged)
- `agentService.runPipeline` input args: `tenantId, decisionId, operatingMode, investorProfile, marketAnalysis, portfolio, priorNarratives`

- [ ] **Step 5: Update Egress mapping + drop IAM**

```typescript
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'ReasoningOutput':  { insert: AdvisoryNarrativeEventTypes.EXPLANATION_GENERATED },
    'AgentCompletion':  { insert: AdvisoryNarrativeEventTypes.NARRATIVE_COMPLETED },
    'AgentFailure':     { insert: AdvisoryNarrativeEventTypes.NARRATIVE_FAILED },
  },
});
```

- [ ] **Step 6: Add stack test for IAM negation + new CDC mapping**

Same shape as PE.

- [ ] **Step 7: Run AN tests**

```bash
pnpm nx test advisory-narrative-ctrl
```

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/
git commit -m "feat(advisory-narrative-ctrl): emit AgentCompletion/Failure via CDC (callback refactor)"
```

---

## Task 8: decision-workflow-ctrl — SnapshotProjectorIngress

Add a new Ingress + handler that subscribes to `INVESTOR_PROFILE_SNAPSHOT_CREATED`/`UPDATED` and `MARKET_SNAPSHOT_UPDATED`, projecting them into DWC-local rows. Mirrors the existing `MandateProjectorIngress` pattern.

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`
- Create: `services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Create: `services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write failing tests**

`test/unit/snapshot-projector.test.ts`:

```typescript
import { createHandlers } from '../../src/handlers/snapshot-projector';

describe('snapshot-projector', () => {
  it('INVESTOR_PROFILE_SNAPSHOT_CREATED → record() with InvestorProfileSnapshot row', async () => {
    const handlers = createHandlers();
    const result = await handlers.INVESTOR_PROFILE_SNAPSHOT_CREATED(
      { subject: { tenantId: 't1', userId: 'u1', agentOutput: { riskScore: 55 }, sourceEventId: 'e1' } },
      { eventId: 'e1', eventType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED', tenantId: 't1' },
    );
    expect(result).toEqual(expect.objectContaining({
      kind: 'record',
      typeName: 'InvestorProfileSnapshot',
      attributes: expect.objectContaining({ tenantId: 't1', userId: 'u1', agentOutput: expect.anything() }),
    }));
  });

  it('INVESTOR_PROFILE_SNAPSHOT_UPDATED → update() with InvestorProfileSnapshot row', async () => {
    // same shape; expect kind: 'update'
  });

  it('MARKET_SNAPSHOT_UPDATED → record() with MarketSnapshot row keyed by region', async () => {
    const handlers = createHandlers();
    const result = await handlers.MARKET_SNAPSHOT_UPDATED(
      { subject: { region: 'us-east-1', agentOutput: { signals: [] }, fastComponentsAt: '...' } },
      { eventId: 'e2', eventType: 'MARKET_SNAPSHOT_UPDATED', tenantId: 'SYSTEM' },
    );
    expect(result.attributes.region).toBe('us-east-1');
    expect(result.attributes.pk).toBeUndefined(); // pk comes from overrides
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx test decision-workflow-ctrl
```

Expected: FAIL — handler file doesn't exist.

- [ ] **Step 3: Create repository helpers**

`services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts`:

```typescript
export const PROJECTED_IP_SNAPSHOT_SK = 'InvestorProfileSnapshot' as const;
export const PROJECTED_MARKET_SNAPSHOT_SK = 'MarketSnapshot' as const;

export function projectedIpSnapshotPk(tenantId: string, userId: string): string {
  return `InvestorProfileSnapshot#${tenantId}#${userId}`;
}

export function projectedMarketSnapshotPk(region: string): string {
  return `MarketSnapshot#${region}`;
}
```

- [ ] **Step 4: Implement the handler**

`services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`:

```typescript
import {
  materializeToTable,
  record,
  update,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import {
  PROJECTED_IP_SNAPSHOT_SK,
  PROJECTED_MARKET_SNAPSHOT_SK,
  projectedIpSnapshotPk,
  projectedMarketSnapshotPk,
} from '../repositories/projected-snapshot.repository';

function projectIpSnapshot(payload: EventPayload, ctx: EventContext, mode: 'insert' | 'update'): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(`${ctx.eventType} missing subject.agentOutput for tenant=${tenantId} user=${userId}`);
  }
  const attrs = {
    tenantId, userId,
    agentOutput,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  const key = { pk: projectedIpSnapshotPk(tenantId, userId), sk: PROJECTED_IP_SNAPSHOT_SK };
  return mode === 'insert'
    ? record('InvestorProfileSnapshot', attrs, key)
    : update('InvestorProfileSnapshot', attrs, { overrides: key });
}

function projectMarketSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const region = (subject.region as string) ?? 'us-east-1';
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!agentOutput) {
    throw new NotRetryableError(`MARKET_SNAPSHOT_UPDATED missing subject.agentOutput for region=${region}`);
  }
  return record('MarketSnapshot', {
    region,
    agentOutput,
    updatedAt: new Date().toISOString(),
  }, { pk: projectedMarketSnapshotPk(region), sk: PROJECTED_MARKET_SNAPSHOT_SK });
}

export const createHandlers = () => ({
  INVESTOR_PROFILE_SNAPSHOT_CREATED: async (p: EventPayload, c: EventContext) => projectIpSnapshot(p, c, 'insert'),
  INVESTOR_PROFILE_SNAPSHOT_UPDATED: async (p: EventPayload, c: EventContext) => projectIpSnapshot(p, c, 'update'),
  MARKET_SNAPSHOT_UPDATED:           async (p: EventPayload, c: EventContext) => projectMarketSnapshot(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'SNAPSHOT_PROJECTION_FAILED',
});
```

- [ ] **Step 5: Add SnapshotProjectorIngress to service.stack.ts**

```typescript
// Alongside the existing MandateProjectorIngress, CallbackIngress
const snapshotProjectorIngress = new Ingress(this, 'SnapshotProjectorIngress', {
  state,
  eventTypes: [
    InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED,
    InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED,
    MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED,
  ],
  handlerEntry: 'src/handlers/snapshot-projector.ts',  // or whatever the construct uses for handler routing
});
```

(Follow the construct's existing pattern for handler routing — `MandateProjectorIngress` is the local reference.)

- [ ] **Step 6: Run tests**

```bash
pnpm nx test decision-workflow-ctrl
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts \
       services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts \
       services/advisory/decision-workflow-ctrl/src/service.stack.ts \
       services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts
git commit -m "feat(decision-workflow-ctrl): snapshot projector ingress for IP + MI snapshots"
```

---

## Task 9: decision-workflow-ctrl — SF state machine rewrite

Replace `ParallelProfiling` with the new projection-read shape. Wrap `LookupMandateSnapshot` in payload-first Choice. PE+AN states keep their `putEvents.waitForTaskToken` shape (no inline change; the change is on the agent side already done in Tasks 6–7).

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` (create if absent)

- [ ] **Step 1: Write failing state-machine tests**

These are CDK snapshot/template assertions on the synthesised state machine definition. Use `aws-cdk-lib/assertions` `Template.findResources('AWS::StepFunctions::StateMachine')` and parse the `DefinitionString`.

```typescript
it('SF definition contains ResolveInvestorProfile Choice with two branches', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  const sm = Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0];
  const def = JSON.parse(sm.Properties.DefinitionString['Fn::Join'][1].join(''));
  expect(def.States.ResolveInvestorProfile.Type).toBe('Choice');
  expect(def.States.ResolveInvestorProfile.Choices).toHaveLength(1);
  expect(def.States.ResolveInvestorProfile.Default).toBe('LookupInvestorProfileSnapshot');
});

it('SF definition contains LookupMarketSnapshot DDB GetItem', () => {
  // similar shape
});

it('SF definition contains ResolveMandateSnapshot Choice wrapping LookupMandateSnapshot', () => { /* ... */ });

it('SF definition no longer references ParallelProfiling or InvokeInvestorProfile / InvokeMarketIntelligence as Task states', () => {
  const stack = createStack();
  const template = Template.fromStack(stack);
  const sm = Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0];
  const def = JSON.parse(sm.Properties.DefinitionString['Fn::Join'][1].join(''));
  expect(def.States.ParallelProfiling).toBeUndefined();
  expect(def.States.InvokeInvestorProfile).toBeUndefined();
  expect(def.States.InvokeMarketIntelligence).toBeUndefined();
});

it('SF definition still invokes PE and AN via putEvents.waitForTaskToken', () => {
  // confirm we haven't accidentally removed PE/AN — they keep their shape, only callbacks change
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

- [ ] **Step 3: Implement the SF rewrite**

Edit `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`:

1. **Remove**: `invokeInvestorProfile` (lines ~95–127), `invokeMarketIntelligence` (line ~129), `parallelProfiling` (line ~169), `mergeParallelOutputs` (line ~185).

2. **Replace**: add four new states.

```typescript
// Helper used by the IP and Mandate Choice branches:
const passWithHoist = (id: string, params: Record<string, unknown>) =>
  new sfn.Pass(this, id, { parameters: params });

// (A) LookupInvestorProfileSnapshot — same shape as the existing LookupMandateSnapshot,
//     different SK and ResultSelector.
const lookupInvestorProfileSnapshot = new sfn.CustomState(this, 'LookupInvestorProfileSnapshot', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:getItem',
    Parameters: {
      TableName: props.tableName,
      Key: {
        pk: { 'S.$': "States.Format('InvestorProfileSnapshot#{}#{}', $.tenantId, $.userId)" },
        sk: { S: 'InvestorProfileSnapshot' },
      },
    },
    ResultSelector: {
      'agentOutput.$': '$.Item.agentOutput.M',           // adapt to DDB attribute marshalling
    },
    ResultPath: '$.agentResults.InvokeInvestorProfile',
  },
});

// Choice: trigger payload-present → HoistInvestorProfileFromTrigger; else → GetItem.
const hoistIpFromTrigger = passWithHoist('HoistInvestorProfileFromTrigger', {
  'agentOutput': {
    'goals.$': "States.Format('{}', $.triggerContext.goal)",  // or copy raw — implementation detail
    'timeHorizon.$': '$.triggerContext.goal.timeHorizonMonths',
    'riskWillingness': 'inline',
    'riskScore.$': '$.triggerContext.riskProfile.score',
    'riskCategory': 'MODERATE',
    'regulatoryFlags': [],
    'suitabilityAssessment': 'inline-from-trigger',
    'confidence': 1.0,
  },
});

// NOTE: the exact field-shape adapter from triggerContext → agentOutput shape needs to
// match what PE+AN consume (subject.investorProfile). Verify against
// services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:51 which reads
// subject.investorProfile as an opaque Record<string, unknown>. We pass a partial shape;
// PE+AN's existing defaults (`?? {}`) fill in absent fields. Acceptable for the trigger-payload path.

const resolveInvestorProfile = new sfn.Choice(this, 'ResolveInvestorProfile')
  .when(sfn.Condition.isPresent('$.triggerContext.goal'), hoistIpFromTrigger)
  .otherwise(lookupInvestorProfileSnapshot);

// (B) LookupMarketSnapshot — always GetItem.
const lookupMarketSnapshot = new sfn.CustomState(this, 'LookupMarketSnapshot', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:getItem',
    Parameters: {
      TableName: props.tableName,
      Key: {
        pk: { 'S.$': "States.Format('MarketSnapshot#{}', $.region)" },
        sk: { S: 'MarketSnapshot' },
      },
    },
    ResultSelector: {
      'agentOutput.$': '$.Item.agentOutput.M',
    },
    ResultPath: '$.agentResults.InvokeMarketIntelligence',
  },
});

// (C) Parallel: ResolveInvestorProfile + LookupMarketSnapshot. Mirrors the old ParallelProfiling shape
//     so PE+AN downstream see the same $.agentResults structure.
const parallelProjections = new sfn.Parallel(this, 'ParallelProjections', {
  resultPath: '$.parallelResults',
});
parallelProjections.branch(resolveInvestorProfile);
parallelProjections.branch(lookupMarketSnapshot);

const mergeProjections = new sfn.Pass(this, 'MergeProjections', {
  parameters: {
    'decisionId.$': '$.decisionId',
    'tenantId.$': '$.tenantId',
    'userId.$': '$.userId',
    'region.$': '$.region',
    'trigger.$': '$.trigger',
    'triggerContext.$': '$.triggerContext',
    'agentResults': {
      'InvokeInvestorProfile': {
        // Same shape as before: agentOutput plus the operatingMode the rest of the SF reads.
        'agentOutput.$': '$.parallelResults[0].agentResults.InvokeInvestorProfile.agentOutput',
        // operatingMode resolved separately by ResolveMandateSnapshot below; we keep this branch
        // structurally compatible with the old MergeParallelOutputs.
      },
      'InvokeMarketIntelligence': {
        'agentOutput.$': '$.parallelResults[1].agentResults.InvokeMarketIntelligence.agentOutput',
      },
    },
  },
});

// (D) ResolveMandateSnapshot Choice (replaces unconditional LookupMandateSnapshot + SetInvestorProfile).
const hoistMandateFromTrigger = new sfn.Pass(this, 'HoistMandateFromTrigger', {
  parameters: {
    'decisionId.$': '$.decisionId', 'tenantId.$': '$.tenantId', 'userId.$': '$.userId',
    'region.$': '$.region', 'trigger.$': '$.trigger', 'triggerContext.$': '$.triggerContext',
    'agentResults.$': '$.agentResults',
    'investorProfile': {
      'operatingMode.$': '$.triggerContext.operatingMode',
    },
  },
});

// existing LookupMandateSnapshot + SetInvestorProfile chained as the "else" branch:
const resolveMandateSnapshot = new sfn.Choice(this, 'ResolveMandateSnapshot')
  .when(sfn.Condition.isPresent('$.triggerContext.operatingMode'), hoistMandateFromTrigger)
  .otherwise(lookupMandateSnapshot.next(setInvestorProfile));
```

3. **Update the chain**: replace the old chain ending in `parallelProfiling.next(mergeParallelOutputs).next(invokePortfolioEngine)` with:

```typescript
const definition = unpackTriggerEnvelope
  .next(parallelProjections)
  .next(mergeProjections)
  .next(resolveMandateSnapshot)
  .next(invokePortfolioEngine)
  .next(invokeAdvisoryNarrative)
  .next(assemblePacket)
  .next(waitForCompliance)
  .next(complianceChoice
    .when(/* unchanged */)
    .when(/* unchanged */)
    .otherwise(/* unchanged */),
  );
```

(The `unpackTriggerEnvelope` Pass adds top-level `region` already from line 369; keep that. Remove the existing `lookupMandateSnapshot.next(setInvestorProfile)` chaining from the top-level flow since it's now inside the Choice's `.otherwise()`.)

4. **Grant DynamoDB:GetItem on the InvestorProfileSnapshot and MarketSnapshot rows.** The existing SF role grant for `lookupMandateSnapshot` covers `dynamodb:GetItem` on `props.tableName` — same table is used for the new lookups, so no new grant needed.

- [ ] **Step 4: Run tests**

```bash
pnpm nx test decision-workflow-ctrl
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
       services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "feat(decision-workflow-ctrl): SF reads projections + payload-first Choices"
```

---

## Task 10: decision-workflow-ctrl — sfn-callback handler updates

Extend `sfn-callback.ts` to handle `PORTFOLIO_COMPLETED`/`NARRATIVE_COMPLETED` (already declared subscriptions in CallbackIngress — see CLAUDE.md) and add new handling for `PORTFOLIO_FAILED`/`NARRATIVE_FAILED`. Remove handling of `INVESTOR_PROFILE_COMPLETED` and `MARKET_ANALYSIS_COMPLETED` (those agents are out of the cycle).

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts`

- [ ] **Step 1: Read the current sfn-callback.ts**

Confirm the current structure. The handler-per-event-type pattern is the local convention. Look for where `SendTaskSuccess` is called and how taskToken + output are extracted from `subject`.

- [ ] **Step 2: Write failing tests**

```typescript
describe('sfn-callback handler — PORTFOLIO_COMPLETED', () => {
  it('calls SendTaskSuccess with taskToken and agentOutput from subject', async () => {
    const sfnClient = { send: jest.fn().mockResolvedValue({}) };
    const handlers = createHandlers({ sfnClient });

    await handlers.PORTFOLIO_COMPLETED(
      { subject: { decisionId: 'd1', taskToken: 'token-pe', agentOutput: { allocations: { allocations: [], totalExposure: 1.0 } } } },
      { eventId: 'e1', eventType: 'PORTFOLIO_COMPLETED', tenantId: 't1' },
    );

    expect(sfnClient.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ taskToken: 'token-pe', output: expect.stringContaining('allocations') }),
    }));
  });
});

describe('sfn-callback handler — PORTFOLIO_FAILED', () => {
  it('calls SendTaskFailure with taskToken, error, cause', async () => {
    const sfnClient = { send: jest.fn().mockResolvedValue({}) };
    const handlers = createHandlers({ sfnClient });

    await handlers.PORTFOLIO_FAILED(
      { subject: { decisionId: 'd1', taskToken: 'token-pe', errorType: 'Error', errorMessage: 'Bedrock throttle' } },
      { eventId: 'e1', eventType: 'PORTFOLIO_FAILED', tenantId: 't1' },
    );

    expect(sfnClient.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ taskToken: 'token-pe', error: 'Error', cause: 'Bedrock throttle' }),
    }));
  });
});

// Same shape for NARRATIVE_COMPLETED / NARRATIVE_FAILED.

it('does not have handlers for INVESTOR_PROFILE_COMPLETED or MARKET_ANALYSIS_COMPLETED', () => {
  const handlers = createHandlers({ sfnClient: { send: jest.fn() } });
  expect(handlers.INVESTOR_PROFILE_COMPLETED).toBeUndefined();
  expect(handlers.MARKET_ANALYSIS_COMPLETED).toBeUndefined();
});
```

- [ ] **Step 3: Run tests, verify fail**

- [ ] **Step 4: Update sfn-callback.ts**

Add the new handlers (PE + AN success + failure paths). Remove the old IP / MI handlers if present. Keep DECISION_APPROVED / DECISION_BLOCKED / USER_CONFIRMED / USER_REJECTED handlers untouched.

```typescript
// Pattern for the four new handlers:
const buildAgentCompletionHandler = (agentLabel: string) => async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string | undefined;
  const agentOutput = subject.agentOutput as Record<string, unknown> | undefined;
  if (!taskToken) {
    throw new NotRetryableError(`${ctx.eventType} missing subject.taskToken`);
  }
  await deps.sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({ agentOutput }),
  }));
  return { output: { resumed: true, agentLabel } };
};

const buildAgentFailureHandler = (agentLabel: string) => async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string | undefined;
  const errorType = (subject.errorType as string | undefined) ?? 'UnknownError';
  const errorMessage = (subject.errorMessage as string | undefined) ?? 'unknown';
  if (!taskToken) {
    throw new NotRetryableError(`${ctx.eventType} missing subject.taskToken`);
  }
  await deps.sfnClient.send(new SendTaskFailureCommand({
    taskToken,
    error: errorType,
    cause: errorMessage,
  }));
  return { output: { failed: true, agentLabel } };
};

handlers.PORTFOLIO_COMPLETED = buildAgentCompletionHandler('portfolio-engine');
handlers.NARRATIVE_COMPLETED = buildAgentCompletionHandler('advisory-narrative');
handlers.PORTFOLIO_FAILED    = buildAgentFailureHandler('portfolio-engine');
handlers.NARRATIVE_FAILED    = buildAgentFailureHandler('advisory-narrative');

// Remove (if present):
// delete handlers.INVESTOR_PROFILE_COMPLETED;
// delete handlers.MARKET_ANALYSIS_COMPLETED;
```

- [ ] **Step 5: Update CallbackIngress subscriptions in service.stack.ts**

```typescript
const callbackIngress = new Ingress(this, 'CallbackIngress', {
  state,
  eventTypes: [
    PortfolioEngineEventTypes.PORTFOLIO_COMPLETED,
    PortfolioEngineEventTypes.PORTFOLIO_FAILED,                  // NEW
    AdvisoryNarrativeEventTypes.NARRATIVE_COMPLETED,
    AdvisoryNarrativeEventTypes.NARRATIVE_FAILED,                // NEW
    ComplianceEventTypes.DECISION_APPROVED,                       // unchanged
    ComplianceEventTypes.DECISION_BLOCKED,                        // unchanged
    AdvisoryBffEventTypes.USER_CONFIRMED,                         // unchanged
    AdvisoryBffEventTypes.USER_REJECTED,                          // unchanged
    // REMOVED: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED
  ],
  // ... existing IAM grants for states:SendTaskSuccess/SendTaskFailure stay HERE
});
```

The `states:SendTaskSuccess` / `states:SendTaskFailure` IAM grant stays on this Ingress role only.

- [ ] **Step 6: Run tests**

```bash
pnpm nx test decision-workflow-ctrl
```

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts \
       services/advisory/decision-workflow-ctrl/src/service.stack.ts \
       services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts
git commit -m "feat(decision-workflow-ctrl): callback ingress handles PE/AN completions + failures"
```

---

## Task 11: Remove obsolete event constants

Drop the now-unused event constants from `domain/events.ts` in each service. The compiler will flag any remaining references.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/domain/events.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/events.ts`

- [ ] **Step 1: Remove constants and HANDLED_EVENT_TYPES entries**

In `decision-workflow-ctrl/src/domain/events.ts`:
- Remove from `DecisionWorkflowEventTypes`: `ANALYZE_INVESTOR_PROFILE`, `ANALYZE_MARKET`.
- Remove from `AGENT_COMPLETION_EVENT_TYPES`: `INVESTOR_PROFILE_COMPLETED`, `MARKET_ANALYSIS_COMPLETED`.

In `investor-profile-ctrl/src/domain/events.ts`:
- Remove from `InvestorProfileEventTypes`: `INVESTOR_PROFILE_COMPLETED`.
- Confirm `HANDLED_EVENT_TYPES` no longer includes `ANALYZE_INVESTOR_PROFILE` (done in Task 1).

In `market-intelligence-ctrl/src/domain/events.ts`:
- Remove from `MarketIntelligenceEventTypes`: `MARKET_ANALYSIS_COMPLETED`.
- Confirm `HANDLED_EVENT_TYPES` no longer includes `ANALYZE_MARKET`.

- [ ] **Step 2: Run typecheck workspace-wide**

```bash
pnpm nx run-many -t typecheck --all
```

Expected: PASS. If any file references a removed constant, fix the reference (most likely import statements that are no longer used). Compiler will flag.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/events.ts \
       services/advisory/investor-profile-ctrl/src/domain/events.ts \
       services/advisory/market-intelligence-ctrl/src/domain/events.ts
git commit -m "chore: remove obsolete advisory-cycle event constants"
```

---

## Task 12: Workspace-wide CDK invariant — no states:* outside CallbackIngress

A single test, placed in `libs/cdk-constructs` or a top-level audit suite, that synthesizes every service stack and asserts the IAM invariant: no role grants `states:SendTaskSuccess` or `states:SendTaskFailure` except `decision-workflow-ctrl-CallbackIngress`.

**Files:**
- Create: `libs/cdk-constructs/test/iam-invariants.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
// Import every service stack class.
import { InvestorProfileCtrlStack } from '@nestfolio/investor-profile-ctrl/stack';
import { MarketIntelligenceCtrlStack } from '@nestfolio/market-intelligence-ctrl/stack';
import { PortfolioEngineCtrlStack } from '@nestfolio/portfolio-engine-ctrl/stack';
import { AdvisoryNarrativeCtrlStack } from '@nestfolio/advisory-narrative-ctrl/stack';
import { DecisionWorkflowCtrlStack } from '@nestfolio/decision-workflow-ctrl/stack';

const SF_ACTIONS = ['states:SendTaskSuccess', 'states:SendTaskFailure'];

function policyGrantsSfActions(policy: any): string[] {
  const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
  const grants: string[] = [];
  for (const stmt of statements) {
    const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
    for (const a of SF_ACTIONS) {
      if (actions.includes(a)) grants.push(a);
    }
  }
  return grants;
}

describe.each([
  ['investor-profile-ctrl', InvestorProfileCtrlStack],
  ['market-intelligence-ctrl', MarketIntelligenceCtrlStack],
  ['portfolio-engine-ctrl', PortfolioEngineCtrlStack],
  ['advisory-narrative-ctrl', AdvisoryNarrativeCtrlStack],
])('%s: no states:SendTaskSuccess/SendTaskFailure grants', (name, StackClass) => {
  it(`forbids SF callback IAM in ${name}`, () => {
    const app = new App();
    const stack = new StackClass(app, name, {/* synth props */});
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    const violations: string[] = [];
    for (const [logicalId, policy] of Object.entries(policies)) {
      const grants = policyGrantsSfActions(policy);
      if (grants.length > 0) violations.push(`${logicalId}: ${grants.join(', ')}`);
    }
    expect(violations).toEqual([]);
  });
});

describe('decision-workflow-ctrl: states:SendTaskSuccess granted only to CallbackIngress role', () => {
  it('CallbackIngress is the sole role granted SF callback IAM', () => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'decision-workflow-ctrl', {/* synth props */});
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const [logicalId, policy] of Object.entries(policies)) {
      const grants = policyGrantsSfActions(policy);
      if (grants.length > 0) {
        // Logical ID should reference CallbackIngress
        expect(logicalId).toMatch(/CallbackIngress/);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm nx test cdk-constructs --testPathPatterns=iam-invariants
```

Expected: PASS (all 4 services have zero grants; DWC's only grant is on CallbackIngress).

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/test/iam-invariants.test.ts
git commit -m "test(cdk-constructs): assert states:SendTaskSuccess granted only to CallbackIngress"
```

---

## Task 13: E2E fixtures — onboarded() waits for snapshot; timeout drop

Update the e2e harness so `onboarded()` awaits `InvestorProfileSnapshot` materialisation, and `withLiveDecision()` defaults to a tighter timeout reflecting the snapshot-based cycle.

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`

- [ ] **Step 1: Extend `onboarded()` with snapshot wait**

After the existing `waitForGraphQL` for `getProfile`, add a DDB poll for `InvestorProfileSnapshot#{tenantId}#{userId}` on the IP-ctrl service table. Mirror the pattern used by `funded()` for `CashBalance` (`fixtures.ts:140-152`):

```typescript
// After the getProfile waitForGraphQL block:
const ipTableName = await ctx.ssm.tableName('investor-profile-ctrl');
const ddbClient = new DynamoDBClient({ region: ctx.region });
const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
try {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await ddbDoc.send(new GetCommand({
      TableName: ipTableName,
      Key: {
        pk: `InvestorProfileSnapshot#${tenant.tenantId}#${tenant.userId}`,
        sk: 'InvestorProfileSnapshot',
      },
    }));
    if (r.Item) return {};
    await new Promise(res => setTimeout(res, 2_000));
  }
  throw new Error('onboarded(): InvestorProfileSnapshot not materialised within 60s');
} finally {
  ddbClient.destroy();
}
```

- [ ] **Step 2: Drop `withLiveDecision()` default timeout**

Change `timeoutMs ?? 180_000` to `timeoutMs ?? 90_000` (and bump back up if observed latency requires it during validation).

- [ ] **Step 3: Run e2e build to ensure nothing else breaks**

```bash
pnpm nx build e2e-feature-tests
```

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit -m "test(e2e): onboarded() waits for InvestorProfileSnapshot; timeout drop"
```

---

## Task 14: MarketSnapshot bootstrap mechanism

A fresh dev deploy has no `MarketSnapshot` row until the 15-min schedule fires. Add a one-time bootstrap step: a CDK custom resource that runs once on stack create/update to emit a synthetic `MARKET_SNAPSHOT_REFRESH_TICK` event, blocking until the snapshot is materialised. This avoids racing the first decision cycle.

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/src/handlers/bootstrap-snapshot.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`

- [ ] **Step 1: Implement the bootstrap Lambda**

`services/advisory/market-intelligence-ctrl/src/handlers/bootstrap-snapshot.ts`:

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger, requireEnv } from '@nestfolio/event-processor';

const eb = new EventBridgeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BUS_NAME = requireEnv('BUS_NAME');
const TABLE_NAME = requireEnv('TABLE_NAME');
const REGION = process.env.AWS_REGION ?? 'us-east-1';

export const handler = async (event: any) => {
  // CloudFormation custom resource lifecycle: Create / Update / Delete.
  // We bootstrap only on Create. Update/Delete are no-ops.
  if (event.RequestType !== 'Create') {
    return { PhysicalResourceId: 'market-snapshot-bootstrap', Status: 'SUCCESS' };
  }

  // Already materialised? Skip.
  const existing = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `MarketSnapshot#${REGION}`, sk: 'MarketSnapshot' },
  }));
  if (existing.Item) {
    logger.info('MarketSnapshot already exists; bootstrap skipped');
    return { PhysicalResourceId: 'market-snapshot-bootstrap', Status: 'SUCCESS' };
  }

  // Emit synthetic refresh tick.
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: 'market-intelligence-ctrl',
      DetailType: 'MARKET_SNAPSHOT_REFRESH_TICK',
      Detail: JSON.stringify({
        id: `bootstrap-${Date.now()}`,
        type: 'MARKET_SNAPSHOT_REFRESH_TICK',
        timestamp: new Date().toISOString(),
        subject: { region: REGION },
        context: { tenantId: 'SYSTEM', userId: 'SYSTEM', region: REGION },
      }),
    }],
  }));

  // Poll for row materialisation. 5-minute deadline; on timeout the resource fails — CFN rolls back.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const r = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `MarketSnapshot#${REGION}`, sk: 'MarketSnapshot' },
    }));
    if (r.Item) {
      logger.info('MarketSnapshot bootstrap complete');
      return { PhysicalResourceId: 'market-snapshot-bootstrap', Status: 'SUCCESS' };
    }
    await new Promise(res => setTimeout(res, 5_000));
  }
  throw new Error('MarketSnapshot bootstrap timed out after 5 minutes');
};
```

- [ ] **Step 2: Wire the custom resource in service.stack.ts**

Use `aws-cdk-lib/custom-resources.AwsCustomResource` or `Provider` pattern. The function needs `events:PutEvents` on the advisoryBus and `dynamodb:GetItem` on the state table.

```typescript
import { Provider } from 'aws-cdk-lib/custom-resources';
import { CustomResource } from 'aws-cdk-lib';

const bootstrapFn = new NodejsFunction(this, 'BootstrapSnapshotFn', {
  entry: 'src/handlers/bootstrap-snapshot.ts',
  // ... runtime, env, etc.
});
state.table.grantReadData(bootstrapFn);
this.eventBus.grantPutEventsTo(bootstrapFn);

const provider = new Provider(this, 'BootstrapSnapshotProvider', {
  onEventHandler: bootstrapFn,
});
new CustomResource(this, 'BootstrapSnapshotResource', {
  serviceToken: provider.serviceToken,
});
```

- [ ] **Step 3: Run synth + tests**

```bash
pnpm nx test market-intelligence-ctrl
pnpm nx synth infrastructure
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/handlers/bootstrap-snapshot.ts \
       services/advisory/market-intelligence-ctrl/src/service.stack.ts
git commit -m "feat(market-intelligence-ctrl): one-time MarketSnapshot bootstrap on stack create"
```

---

## Task 15: Service card regeneration

Each modified service's `CLAUDE.md` card is now stale. Regenerate via the `audit-service` skill.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/CLAUDE.md`
- Modify: `services/advisory/market-intelligence-ctrl/CLAUDE.md`
- Modify: `services/advisory/portfolio-engine-ctrl/CLAUDE.md`
- Modify: `services/advisory/advisory-narrative-ctrl/CLAUDE.md`
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`

- [ ] **Step 1: Run audit-service for each affected service**

```bash
# Repeat for each of the 5 services
.claude/skills/audit-service/run.sh investor-profile-ctrl --regenerate
.claude/skills/audit-service/run.sh market-intelligence-ctrl --regenerate
.claude/skills/audit-service/run.sh portfolio-engine-ctrl --regenerate
.claude/skills/audit-service/run.sh advisory-narrative-ctrl --regenerate
.claude/skills/audit-service/run.sh decision-workflow-ctrl --regenerate
```

(If the skill doesn't have a `run.sh`, invoke via the `Skill` tool with `audit-service` and the service name as argument; the regenerated card lands as a file write.)

- [ ] **Step 2: Spot-check each card**

Each card should now reflect:
- IP: Ingress subscribes to INVESTOR_PROFILE_UPDATED + MANDATE_ISSUED + OPERATING_MODE_CHANGED; Egress emits INVESTOR_PROFILE_SNAPSHOT_CREATED/UPDATED.
- MI: Ingress includes MARKET_SNAPSHOT_REFRESH_TICK; Egress emits MARKET_SNAPSHOT_UPDATED; schedule rule mentioned.
- PE/AN: Egress emits PORTFOLIO_COMPLETED/PORTFOLIO_FAILED (resp. NARRATIVE_*); no states:* IAM grants noted.
- DWC: SnapshotProjectorIngress added; CallbackIngress subscriptions list reflects PORTFOLIO_FAILED + NARRATIVE_FAILED additions + IP/MI completion removals.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/{investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl}/CLAUDE.md
git commit -m "docs(advisory): regen service cards post-precomputation+callback refactor"
```

---

## Task 16: Regenerate the advisory-cycle flow doc + C4 diagrams

Two derived docs depend on the SF + Ingress shape: `docs/data-flows/advisory-cycle.md` (generated from `flows/advisory-cycle.flow.yaml`) and the C4 diagrams (generated from CDK stacks).

- [ ] **Step 1: Update `flows/advisory-cycle.flow.yaml`**

Edit the flow YAML to reflect:
- Steps 5-8 (ANALYZE_INVESTOR_PROFILE / ANALYZE_MARKET) replaced by snapshot lookups (Direct DDB GetItem from DWC's own table)
- New PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED hops via CallbackIngress
- New cross-domain receivers if any (none expected — these events stay within advisoryBus)

- [ ] **Step 2: Regenerate the markdown via the generator**

```bash
node tools/generate-flow-docs.mjs
```

Confirm `docs/data-flows/advisory-cycle.md` updated. Spot-check the Mermaid diagrams reflect the new shape.

- [ ] **Step 3: Regenerate C4 diagrams**

```bash
.claude/skills/generate-c4-diagrams/run.sh
```

(Or via `Skill` tool.) Visually verify the SVGs — both ANALYZE_* arrows should be gone, snapshot CDC arrows should appear from IP/MI back to DWC, PORTFOLIO_COMPLETED/NARRATIVE_COMPLETED arrows now flow into DWC's CallbackIngress.

- [ ] **Step 4: Commit**

```bash
git add flows/advisory-cycle.flow.yaml docs/data-flows/advisory-cycle.md docs/c4/
git commit -m "docs(architecture): regen advisory-cycle flow + C4 diagrams post-refactor"
```

---

## Task 17: Workspace-wide test pass

Run all affected unit + lint targets and resolve any cross-service breakage.

- [ ] **Step 1: Run nx affected**

```bash
pnpm nx affected -t test,lint --base=origin/main
```

Expected: PASS for all affected projects.

If failures appear, they are most likely:
- Other services importing removed event constants from `decision-workflow-ctrl/events` (e.g. advisory-bff subscribing to `INVESTOR_PROFILE_COMPLETED`). Drop the subscription if obsolete, or rename to the new event if it was actually meaningful.
- CDK snapshot drift in unaffected projects — accept the drift via `--update-snapshot` only if you've manually confirmed the diff is the intended consequence of this work.

- [ ] **Step 2: Commit any fix-ups**

```bash
git add <affected files>
git commit -m "fix: resolve cross-service drift after advisory-cycle refactor"
```

---

## Task 18: Integration tests

Add integration tests for the new paths.

**Files:**
- Create: `services/advisory/investor-profile-ctrl/test/integration/snapshot-materialisation.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/integration/agent-completion-emission.integration.test.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/integration/agent-completion-emission.integration.test.ts`
- Create: `services/advisory/decision-workflow-ctrl/test/integration/snapshot-projector.integration.test.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: investor-profile-ctrl integration**

Use `integration-testing` harness. Scenario: publish `INVESTOR_PROFILE_UPDATED`, poll for `InvestorProfileSnapshot` row in IP-ctrl table, assert `agentOutput` shape matches schema.

Reference the existing patterns in `services/advisory/investor-profile-ctrl/test/integration/` (if absent, follow the shape used in another advisory service).

- [ ] **Step 2: market-intelligence-ctrl integration**

Extend the existing integration test with:
- "fast-tier merge on feed event": publish YAHOO_FINANCE_UPDATED twice with different event IDs, assert `MarketSnapshot.fastComponentsAt` updates, both IDs appear in `sourceEventIds`.
- "slow-tier rebuild on schedule tick": publish MARKET_SNAPSHOT_REFRESH_TICK, assert `slowComponentsAt` updates.
- "idempotency on feed replay": publish same eventId twice, assert agent runs once.

- [ ] **Step 3: portfolio-engine-ctrl integration**

Scenario: publish synthetic CONSTRUCT_PORTFOLIO with taskToken on subject, use EventBusTrap to assert PORTFOLIO_COMPLETED emission with taskToken + agentOutput on subject.

Failure scenario: mock the agent to throw, assert PORTFOLIO_FAILED is emitted with taskToken + errorType + errorMessage.

- [ ] **Step 4: advisory-narrative-ctrl integration**

Same shape as Step 3 for GENERATE_NARRATIVE / NARRATIVE_COMPLETED.

- [ ] **Step 5: decision-workflow-ctrl snapshot-projector integration**

Publish a synthetic INVESTOR_PROFILE_SNAPSHOT_CREATED event with full payload, poll for the projection row in DWC's table, assert it matches.

- [ ] **Step 6: decision-workflow-ctrl SF integration**

Add CallbackIngress scenarios: publish PORTFOLIO_COMPLETED with taskToken on subject, assert the corresponding SF execution resumes (in dev, this requires a live SF execution; integration test asserts SendTaskSuccess was called with the right token — use AWS SDK mocks or the integration-testing's SFnClient harness).

Add payload-first Choice scenario: drive a SF execution with synthetic INVESTOR_PROFILE_UPDATED carrying `operatingMode=AGGRESSIVE` inline; pre-write `MandateSnapshot` with `operatingMode=BALANCED`; assert PE receives `AGGRESSIVE` (verify via EventBusTrap on CONSTRUCT_PORTFOLIO).

- [ ] **Step 7: Run integration tests**

```bash
pnpm nx run-many -t test-integration \
  --projects=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/*/test/integration/
git commit -m "test(integration): cover precomputation snapshots + callback refactor"
```

---

## Task 19: Deploy to dev + scoped E2E validation

Deploy the 5 affected services, then run only the involved e2e scenarios.

- [ ] **Step 1: Deploy**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl \
  2>&1 | tee /tmp/deploy-precomputation.log
```

Expected: all 5 services deploy successfully. The `BootstrapSnapshotResource` runs as part of the market-intelligence-ctrl stack and blocks until MarketSnapshot is materialised.

- [ ] **Step 2: Verify snapshots materialised**

```bash
AWS_PROFILE=nestfolio-dev aws dynamodb get-item \
  --table-name dev-market-intelligence-ctrl \
  --key '{"pk":{"S":"MarketSnapshot#us-east-1"},"sk":{"S":"MarketSnapshot"}}'
```

Expected: returns the row.

- [ ] **Step 3: Run targeted e2e scenarios**

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features \
  --testPathPatterns='advisory/first-decision|advisory/rebalance-on-drift'
```

Expected: both scenarios PASS.

If either flakes-then-passes on a rerun: pull CloudWatch evidence from the failing window. See [[feedback-flake-means-broken]] — a confirmation rerun is required, not optional.

- [ ] **Step 4: Validate CloudWatch event volume**

```bash
# Zero ANALYZE_INVESTOR_PROFILE in 30-min post-deploy window
AWS_PROFILE=nestfolio-dev aws logs start-query \
  --log-group-name /aws/lambda/dev-decision-workflow-ctrl-* \
  --start-time $(date -v-30M +%s) --end-time $(date +%s) \
  --query-string "fields @timestamp, @message | filter @message like /ANALYZE_INVESTOR_PROFILE/ | stats count() as c"
# Expected: c = 0

# Non-zero INVESTOR_PROFILE_SNAPSHOT_CREATED
AWS_PROFILE=nestfolio-dev aws logs start-query \
  --log-group-name /aws/lambda/dev-investor-profile-ctrl-* \
  --start-time $(date -v-30M +%s) --end-time $(date +%s) \
  --query-string "fields @timestamp, @message | filter @message like /INVESTOR_PROFILE_SNAPSHOT_CREATED/ | stats count() as c"
# Expected: c > 0
```

Repeat for PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED.

- [ ] **Step 5: IAM audit**

```bash
for svc in investor-profile-ctrl market-intelligence-ctrl portfolio-engine-ctrl advisory-narrative-ctrl; do
  role_name=$(AWS_PROFILE=nestfolio-dev aws lambda get-function --function-name "dev-${svc}-IngressHandler" --query 'Configuration.Role' --output text | awk -F/ '{print $NF}')
  echo "=== $svc role: $role_name ==="
  AWS_PROFILE=nestfolio-dev aws iam list-attached-role-policies --role-name "$role_name"
  AWS_PROFILE=nestfolio-dev aws iam list-role-policies --role-name "$role_name"
done | grep -i 'sendtasksuccess\|sendtaskfailure'
```

Expected: empty output (no role grants either action).

---

## Task 20: Ship the backlog file

Close out the impl workstream.

**Files:**
- Modify: `docs/backlog/advisory-cycle-agent-precomputation-impl.md`
- Modify: `docs/BACKLOG.md` (regenerated)

- [ ] **Step 1: Mark shipped + fill validation_gate**

In `docs/backlog/advisory-cycle-agent-precomputation-impl.md`:
- `status: shipped`
- `validation_gate:` populated with commit SHAs, deploy log timestamp, e2e command output summary, CloudWatch query results, IAM audit confirmation.

- [ ] **Step 2: Regenerate index**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/advisory-cycle-agent-precomputation-impl.md docs/BACKLOG.md
git commit -m "docs(backlog): ship advisory-cycle-agent-precomputation-impl"
```

---

## Task 21: Finishing the development branch

Hand off to the finishing skill.

- [ ] **Step 1: Invoke `superpowers:finishing-a-development-branch`**

It handles the squash-merge to main, branch deletion via `gh pr merge --squash --delete-branch`, and worktree cleanup ordering. Do not run `gh pr create` manually.

---

## Open questions (defer to execution; raise in the executing-plans review checkpoints)

1. **Scheduled rule envelope shape (Task 5).** If `EventBusTarget` from `aws-events-targets` can't produce a full event-processor envelope inline, swap to a tiny `scheduled-emitter` Lambda target that builds the envelope and calls `PutEvents`. Verify on first synth.

2. **`update()` list-append semantics for `sourceEventIds` (Task 4).** The event-processor `update()` helper may not support DDB `list_append` natively. If not, accept overwrite semantics (each rebuild stores only the latest event id) until a downstream consumer actually queries the history.

3. **`agentOutput` shape adapter for `HoistInvestorProfileFromTrigger` (Task 9).** PE+AN read `subject.investorProfile` as opaque; defaults fill missing fields. The trigger-payload path provides a partial shape — acceptable for happy path. Edge case: if PE/AN's prompts ever start asserting on specific snapshot fields (e.g., `regulatoryFlags`), the hoist must be extended.

4. **`AgentCompletion` / `AgentFailure` row TTL.** Audit-only post-callback. Defer cleanup design until row count justifies it.

5. **Extract `cdk-constructs/extensions/agent-callback-pipeline`.** Two callers (PE, AN). Rule of three — extract on the third caller, not now.

---

## Self-review (executed during plan writing)

**Spec coverage:**
- ✓ IP precomputation: Tasks 2, 3
- ✓ MI precomputation + scheduled tick: Tasks 4, 5, 14 (bootstrap)
- ✓ Payload-first IP / Mandate Choice + Market GetItem in SF: Task 9
- ✓ PE / AN callback refactor: Tasks 6, 7, 10
- ✓ DWC SnapshotProjector: Task 8
- ✓ IAM invariant: Task 12 (workspace-wide) + per-service stack tests in Tasks 3, 5, 6, 7
- ✓ Domain types + events: Task 1
- ✓ E2E fixtures: Task 13
- ✓ Bootstrap MarketSnapshot: Task 14
- ✓ Service cards regen: Task 15
- ✓ Flow doc + C4 regen: Task 16
- ✓ Validation gate (deploy, e2e, CW, IAM): Task 19
- ✓ Backlog close-out: Task 20
- ✓ Branch finishing: Task 21

**Placeholder scan:** No "TBD", "TODO", or "implement appropriately" placeholders. The three deferred details (scheduled rule envelope, `list_append`, hoist adapter) are explicit, named open questions with fallback strategies, not vague gaps.

**Type / name consistency:**
- `InvestorProfileSnapshot` / `MarketSnapshot` / `AgentCompletion` / `AgentFailure` row type names used consistently across Tasks 1, 2, 3, 4, 5, 6, 7, 8.
- Event constants (`PORTFOLIO_COMPLETED`, `PORTFOLIO_FAILED`, etc.) used consistently across producer and consumer tasks.
- SF state names (`ResolveInvestorProfile`, `LookupMarketSnapshot`, `ResolveMandateSnapshot`, `ParallelProjections`, `MergeProjections`) used consistently in Task 9 and the test assertions.
