# Onboarding Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate onboarding-bff from investor-bff — own table, onboarding-native domain model, single ONBOARDING_COMPLETED fat event via CDC, new onboarding-mfe, shell routing guards.

**Architecture:** onboarding-bff stores a single OnboardingSession aggregate in its own DynamoDB table. On completion, CDC emits ONBOARDING_COMPLETED with raw onboarding data. investor-bff consumes the event and atomically creates all investor domain entities. A new onboarding-mfe serves the onboarding UI, with shell guards routing based on onboardingCompletedAt.

**Tech Stack:** NestJS/CDK, DynamoDB, EventBridge CDC, Angular 19 + Native Federation, NgRx Signals, LangGraph, CopilotKit

**Spec:** `docs/superpowers/specs/2026-03-24-onboarding-isolation-design.md`

---

## Task 1: Rename service directory and update Nx config

**Files:**
- Rename: `services/investor/onboarding-agent-bff/` → `services/investor/onboarding-bff/`
- Modify: `services/investor/onboarding-bff/project.json`

- [ ] **Step 1: Rename directory**

```bash
mv services/investor/onboarding-agent-bff services/investor/onboarding-bff
```

- [ ] **Step 2: Update project.json name**

In `services/investor/onboarding-bff/project.json`, change `"name": "onboarding-agent-bff"` to `"name": "onboarding-bff"`. Update `sourceRoot` if it references the old path.

- [ ] **Step 3: Update any workspace references**

Search the codebase for `onboarding-agent-bff` and update to `onboarding-bff`:
- `tsconfig.base.json` path aliases (e.g. `@nestfolio/onboarding-agent-bff/*`)
- Hub stack imports in `services/investor/investor-hub/` if it registers this service
- Any `nx.json` or workspace config references

```bash
pnpm nx reset
```

- [ ] **Step 4: Verify the rename**

```bash
pnpm nx show project onboarding-bff
```

Expected: project details display correctly.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename onboarding-agent-bff to onboarding-bff"
```

---

## Task 2: Rewrite onboarding-bff domain model — OnboardingSession aggregate

**Files:**
- Modify: `services/investor/onboarding-bff/src/domain/schemas.ts`
- Modify: `services/investor/onboarding-bff/src/domain/models.ts`
- Modify: `services/investor/onboarding-bff/src/domain/events.ts`
- Test: `services/investor/onboarding-bff/test/domain/schemas.test.ts`

- [ ] **Step 1: Write the failing test for new schemas**

Create `services/investor/onboarding-bff/test/domain/schemas.test.ts`:

```typescript
import { OnboardingSessionSchema, OnboardingCompletedRecordSchema, PhasesSchema } from '../../src/domain/schemas';

describe('OnboardingSessionSchema', () => {
  it('validates a valid in-progress session', () => {
    const session = {
      sessionId: 'sess-1',
      status: 'in_progress',
      currentPhase: 'capital',
      phaseIndex: 3,
      phases: {
        goal: { objective: 'Capital growth' },
        horizon: { years: 5 },
        mode: { accountMode: 'simulation' },
      },
      agentMemorySessionId: 'mem-1',
      startedAt: '2026-03-24T00:00:00Z',
      ttl: 1711324800,
    };
    expect(OnboardingSessionSchema.parse(session)).toBeDefined();
  });

  it('rejects invalid phase', () => {
    expect(() =>
      OnboardingSessionSchema.parse({
        sessionId: 'x', status: 'in_progress', currentPhase: 'invalid',
        phaseIndex: 0, phases: {}, agentMemorySessionId: 'y',
        startedAt: '2026-01-01T00:00:00Z', ttl: 0,
      }),
    ).toThrow();
  });
});

describe('OnboardingCompletedRecordSchema', () => {
  it('validates a completed record with raw onboarding data', () => {
    const record = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      goal: { objective: 'Retirement savings' },
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      currency: 'EUR',
      riskTolerance: 2,
      riskExperience: 1,
      operatingMode: 'BALANCED',
      mandateAccepted: true,
    };
    expect(OnboardingCompletedRecordSchema.parse(record)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test onboarding-bff --testPathPattern=domain/schemas
```

Expected: FAIL — schemas don't exist yet.

- [ ] **Step 3: Rewrite schemas.ts**

Replace `services/investor/onboarding-bff/src/domain/schemas.ts` with:

```typescript
import { z } from 'zod';

export const OnboardingPhaseSchema = z.enum([
  'goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate', 'completed',
]);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

export const PhasesSchema = z.object({
  goal: z.object({ objective: z.string() }).optional(),
  horizon: z.object({ years: z.number().int().min(1).max(30) }).optional(),
  mode: z.object({ accountMode: z.enum(['simulation', 'live']) }).optional(),
  capital: z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) }).optional(),
  risk: z.object({
    toleranceIdx: z.number().int().min(0).max(3),
    experienceIdx: z.number().int().min(0).max(3),
    score: z.number().int().min(0).max(100),       // display-only cached value
    category: z.enum(['conservative', 'moderate', 'aggressive']),  // display-only cached value
  }).optional(),
  operatingMode: z.object({ mode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']) }).optional(),
  mandate: z.object({ accepted: z.boolean() }).optional(),
});
export type Phases = z.infer<typeof PhasesSchema>;

export const OnboardingSessionSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  currentPhase: OnboardingPhaseSchema,
  phaseIndex: z.number().int().min(0).max(7),
  phases: PhasesSchema,
  agentMemorySessionId: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  ttl: z.number(),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

/** Shape of the CDC record written on onboarding completion.
 *  Raw onboarding vocabulary — no investor-domain knowledge. */
export const OnboardingCompletedRecordSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().min(1),
  goal: z.object({ objective: z.string() }),
  horizonYears: z.number().int().min(1).max(30),
  accountMode: z.enum(['simulation', 'live']),
  capitalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  riskTolerance: z.number().int().min(0).max(3),
  riskExperience: z.number().int().min(0).max(3),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  mandateAccepted: z.literal(true),
});
export type OnboardingCompletedRecord = z.infer<typeof OnboardingCompletedRecordSchema>;
```

- [ ] **Step 4: Update models.ts**

Replace `services/investor/onboarding-bff/src/domain/models.ts`:

```typescript
export type { OnboardingSession, OnboardingPhase, Phases, OnboardingCompletedRecord } from './schemas';
```

- [ ] **Step 5: Keep events.ts as-is**

`events.ts` already exports `ONBOARDING_STARTED` and `ONBOARDING_COMPLETED`. No change needed.

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm nx test onboarding-bff --testPathPattern=domain/schemas
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(onboarding-bff): replace investor entity schemas with OnboardingSession aggregate"
```

---

## Task 3: Rewrite onboarding-bff repository

**Files:**
- Modify: `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts`
- Test: `services/investor/onboarding-bff/test/repositories/onboarding.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Rewrite `services/investor/onboarding-bff/test/repositories/onboarding.repository.test.ts`. The test should verify:

```typescript
import { OnboardingRepository } from '../../src/repositories/onboarding.repository';

// Use existing test setup pattern (mock DynamoDBClient or local DynamoDB)

describe('OnboardingRepository', () => {
  let repo: OnboardingRepository;

  beforeEach(() => {
    repo = new OnboardingRepository('test-table');
  });

  describe('createSession', () => {
    it('creates a session with status in_progress and empty phases', async () => {
      // Assert: put called with __typename: 'OnboardingSession', status: 'in_progress', phases: {}
    });
  });

  describe('updatePhase', () => {
    it('updates the phases map and advances currentPhase', async () => {
      // Assert: UpdateCommand called with SET phases.#phase = :data, currentPhase = :next
    });
  });

  describe('completeSession', () => {
    it('updates session to completed and writes OnboardingCompleted CDC record', async () => {
      // Assert: transactWrite called with 2 items:
      // 1. Update OnboardingSession status → completed, completedAt set
      // 2. Put OnboardingCompleted record with raw data from phases
    });
  });

  describe('getActiveSession', () => {
    it('returns the most recent non-completed session', async () => {
      // Assert: query with filter currentPhase <> completed
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test onboarding-bff --testPathPattern=repositories/onboarding
```

Expected: FAIL — new methods don't exist yet.

- [ ] **Step 3: Rewrite the repository**

Replace `services/investor/onboarding-bff/src/repositories/onboarding.repository.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { Phases, OnboardingSession } from '../domain/schemas';

function sessionPk(tenantId: string, userId: string): string {
  return `OnboardingSession#${tenantId}#${userId}`;
}

export class OnboardingRepository extends TableRepository {
  private readonly log = withMethodLogging('OnboardingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createSession = this.log('createSession',
    async (tenantId: string, userId: string, agentMemorySessionId: string): Promise<OnboardingSession & { sessionId: string }> => {
      const now = getTime();
      const sessionId = getUUID();

      const item: TableEntry = {
        pk: sessionPk(tenantId, userId),
        sk: `OnboardingSession#${sessionId}`,
        __typename: 'OnboardingSession',
        tenantId,
        timestamp: now,
        sessionId,
        status: 'in_progress',
        currentPhase: 'goal',
        phaseIndex: 0,
        phases: {},
        startedAt: now,
        agentMemorySessionId,
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      };

      await this.put(item);

      return {
        sessionId,
        status: 'in_progress',
        currentPhase: 'goal',
        phaseIndex: 0,
        phases: {},
        startedAt: now,
        agentMemorySessionId,
        ttl: item.ttl as number,
      };
    },
  );

  readonly updatePhase = this.log('updatePhase',
    async (tenantId: string, userId: string, sessionId: string, phase: string, data: Record<string, unknown>, nextPhase: string, nextIdx: number): Promise<void> => {
      const pk = sessionPk(tenantId, userId);
      const now = getTime();

      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: `OnboardingSession#${sessionId}` },
        UpdateExpression: 'SET phases.#phase = :data, currentPhase = :next, phaseIndex = :idx, #ts = :ts',
        ExpressionAttributeNames: { '#phase': phase, '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':data': data, ':next': nextPhase, ':idx': nextIdx, ':ts': now },
        ConditionExpression: 'attribute_exists(pk)',
      }));
    },
  );

  readonly completeSession = this.log('completeSession',
    async (tenantId: string, userId: string, sessionId: string, phases: Phases): Promise<void> => {
      const pk = sessionPk(tenantId, userId);
      const now = getTime();

      // CDC record — raw onboarding data, onboarding vocabulary only
      const cdcRecord: TableEntry = {
        pk: `OnboardingCompleted#${tenantId}#${userId}`,
        sk: `OnboardingCompleted#${sessionId}`,
        __typename: 'OnboardingCompleted',
        tenantId,
        userId,
        timestamp: now,
        goal: phases.goal!,
        horizonYears: phases.horizon!.years,
        accountMode: phases.mode!.accountMode,
        capitalAmount: phases.capital!.amount,
        currency: phases.capital!.currency,
        riskTolerance: phases.risk!.toleranceIdx,
        riskExperience: phases.risk!.experienceIdx,
        operatingMode: phases.operatingMode!.mode,
        mandateAccepted: true,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30-day cleanup
      };

      await this.transactWrite({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: `OnboardingSession#${sessionId}` },
              UpdateExpression: 'SET #status = :status, completedAt = :now, currentPhase = :phase, phaseIndex = :idx, #ts = :ts',
              ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':status': 'completed', ':now': now, ':phase': 'completed', ':idx': 7, ':ts': now },
            },
          },
          { Put: { TableName: this.tableName, Item: cdcRecord } },
        ],
      });
    },
  );

  readonly getActiveSession = this.log('getActiveSession',
    async (tenantId: string, userId: string): Promise<Record<string, unknown> | null> => {
      const pk = sessionPk(tenantId, userId);
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status <> :completed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'OnboardingSession#', ':completed': 'completed' },
        ScanIndexForward: false,
        Limit: 1,
      }));
      return result.Items?.[0] ?? null;
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test onboarding-bff --testPathPattern=repositories/onboarding
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(onboarding-bff): rewrite repository with OnboardingSession aggregate and CDC record"
```

---

## Task 4: Rewrite commit-phase tool and update agent state

**Files:**
- Modify: `services/investor/onboarding-bff/src/agent/tools/commit-phase.ts`
- Modify: `services/investor/onboarding-bff/src/agent/state.ts`
- Modify: `services/investor/onboarding-bff/src/agent/session.ts`
- Test: `services/investor/onboarding-bff/test/tools/commit-phase.test.ts`

- [ ] **Step 1: Write/update the failing test**

Update `services/investor/onboarding-bff/test/tools/commit-phase.test.ts`:

```typescript
// Test that commit_phase for any non-mandate phase calls repo.updatePhase(...)
// Test that commit_phase for 'mandate' calls repo.completeSession(...)
// Test that the tool returns the correct "Next: ..." message
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test onboarding-bff --testPathPattern=tools/commit-phase
```

- [ ] **Step 3: Rewrite commit-phase.ts**

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OnboardingRepository } from '../../repositories/onboarding.repository';
import { PHASE_ORDER, nextPhase, phaseIndexOf, type Phase } from '../state';
import type { Phases } from '../../domain/schemas';

const CommitPhaseSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  phase: z.enum(PHASE_ORDER),
  data: z.record(z.unknown()),
  /** Required only for 'mandate' phase — the full accumulated phases map */
  allPhases: z.record(z.unknown()).optional(),
});

export function createCommitPhaseTool(repo: OnboardingRepository): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'commit_phase',
    description: 'Persist phase data and advance to the next phase. On mandate phase, completes the session.',
    schema: CommitPhaseSchema,
    func: async (input) => {
      const { tenantId, userId, sessionId, phase, data, allPhases } = input;
      const next = nextPhase(phase as Phase);
      const nextIdx = next === 'completed' ? 7 : phaseIndexOf(next as Phase);

      if (phase === 'mandate' && allPhases) {
        await repo.completeSession(tenantId, userId, sessionId, allPhases as unknown as Phases);
      } else {
        await repo.updatePhase(tenantId, userId, sessionId, phase, data, next, nextIdx);
      }

      return `Phase "${phase}" committed. Next: "${next}".`;
    },
  });
}
```

- [ ] **Step 4: Update agent state.ts**

In `services/investor/onboarding-bff/src/agent/state.ts`:

- Remove the import of `RiskProfileDataSchema` (no longer exists in new schemas)
- The `OnboardingAnnotation` remains the same shape (phase, phaseIndex, goal, horizonYears, accountMode, capitalAmount, riskProfile, operatingMode, mandateAccepted, turnCount, messages, sessionId, tenantId, userId) — the annotations represent the in-memory agent state, not the DDB model
- Update `OnboardingStateSchema` to remove the `riskProfile: RiskProfileDataSchema` reference and use a plain object instead:

```typescript
riskProfile: z.object({
  toleranceIdx: z.number(), experienceIdx: z.number(),
  score: z.number(), category: z.string(),
}).optional(),
```

- [ ] **Step 5: Update session.ts rehydration**

In `services/investor/onboarding-bff/src/agent/session.ts`:

Rehydration now reads from the single `OnboardingSession` item's `phases` map:

```typescript
import type { Phase } from './state';

interface SessionRecord {
  currentPhase: string;
  phaseIndex: number;
  sessionId: string;
  agentMemorySessionId: string;
  phases: Record<string, unknown>;
}

export function rehydrateState(session: SessionRecord | null): Record<string, unknown> {
  if (!session) {
    return { phase: 'goal' as Phase, phaseIndex: 0, totalPhases: 7, turnCount: 0, messages: [] };
  }

  const p = session.phases ?? {};
  const goal = p.goal as { objective: string } | undefined;
  const horizon = p.horizon as { years: number } | undefined;
  const mode = p.mode as { accountMode: string } | undefined;
  const capital = p.capital as { amount: number } | undefined;
  const risk = p.risk as Record<string, unknown> | undefined;
  const opMode = p.operatingMode as { mode: string } | undefined;

  return {
    phase: session.currentPhase as Phase,
    phaseIndex: session.phaseIndex,
    totalPhases: 7,
    turnCount: 0,
    sessionId: session.sessionId,
    goal: goal?.objective,
    horizonYears: horizon?.years,
    accountMode: mode?.accountMode,
    capitalAmount: capital?.amount,
    riskProfile: risk,
    operatingMode: opMode?.mode,
    messages: [],
  };
}
```

- [ ] **Step 6: Run all onboarding-bff tests**

```bash
pnpm nx test onboarding-bff
```

Expected: Tests that depend on removed schemas/methods may fail — fix imports. Core new tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(onboarding-bff): rewrite commit-phase, state, and session for aggregate model"
```

---

## Task 5: Update onboarding-bff server.ts for new repository API

**Files:**
- Modify: `services/investor/onboarding-bff/src/runtime/server.ts`
- Test: `services/investor/onboarding-bff/test/runtime/server.test.ts`

- [ ] **Step 1: Update server.ts**

The `/session` endpoint changes: rehydration no longer needs a separate `committed` parameter — the session item contains everything in `phases`.

```typescript
app.get('/session', async (c) => {
  const tenantId = c.req.header('x-tenant-id') ?? '';
  const userId = c.req.header('x-user-id') ?? '';

  if (!tenantId || !userId) {
    return c.json({ newSession: true });
  }

  const tableName = process.env['TABLE_NAME'] ?? '';
  const repo = new OnboardingRepository(tableName);
  const session = await repo.getActiveSession(tenantId, userId);

  if (!session) {
    return c.json({ newSession: true });
  }

  if (session.currentPhase === 'completed' || session.status === 'completed') {
    return c.json({ completed: true });
  }

  const { rehydrateState } = await import('../agent/session');
  const state = rehydrateState(session as any);
  return c.json({ activeSession: true, state });
});
```

- [ ] **Step 2: Update existing server tests**

Update `services/investor/onboarding-bff/test/runtime/server.test.ts` to match new rehydration signature (single argument).

- [ ] **Step 3: Run tests**

```bash
pnpm nx test onboarding-bff --testPathPattern=runtime/server
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(onboarding-bff): update server for single-item session rehydration"
```

---

## Task 6: Add Egress to onboarding-bff CDK stack — own table + CDC

**Files:**
- Modify: `services/investor/onboarding-bff/src/service.stack.ts`
- Create: `services/investor/onboarding-bff/src/handlers/event-publisher.ts`

- [ ] **Step 1: Create the CDC handler**

Create `services/investor/onboarding-bff/src/handlers/event-publisher.ts`:

```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'onboarding-bff',
  eventTypeMap: buildEventTypeMap(
    ['OnboardingCompleted'],
    { 'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED' },
  ),
});
```

- [ ] **Step 2: Rewrite service.stack.ts**

```typescript
import * as path from 'path';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { ServiceStack, ServiceStackProps, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';

export class OnboardingBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });
    // Own table created by default State construct

    // Egress — CDC for ONBOARDING_COMPLETED
    new Egress(this, 'Egress', {
      publishableTypes: ['OnboardingCompleted'],
    });

    // Model IDs from SSM (shared with advisory services)
    const sonnetModelId = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/advisory-hub/sonnet-model-id`,
    );

    // Knowledge Base for product documentation RAG
    const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', {
      kbName: 'nestfolio-docs',
      description: 'Nestfolio product documentation for onboarding agent',
    });

    // Lambda handler for RAG search tool
    const searchKbFn = new NodejsFunction(this, 'SearchKbFn', {
      entry: path.join(__dirname, 'agent/tools/search-kb.handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
      },
    });

    searchKbFn.addToRolePolicy(knowledgeBase.triggerSyncPolicy());

    // AgentRuntime — uses own table
    new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding-agent',
      agentCodePath: path.join(__dirname, '..'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      tables: [this.state.table],
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: this.state.table.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
      },
    });
  }
}
```

- [ ] **Step 3: Verify CDK synth**

```bash
pnpm nx run onboarding-bff:cdk-synth 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(onboarding-bff): own DynamoDB table + Egress CDC for ONBOARDING_COMPLETED"
```

---

## Task 7: Remove investor-hub SSM table-name export

**Files:**
- Search entire codebase for `investor-hub/table-name` to locate the SSM parameter source
- Remove the export wherever it's found

- [ ] **Step 1: Locate the SSM parameter**

```bash
grep -r "investor-hub/table-name" --include="*.ts" --include="*.json" services/ libs/
```

After the onboarding-bff stack rewrite (Task 6), the only consumer is gone. Find and remove the producer.

Note: the investor-hub stack (`services/investor/investor-hub/src/service.stack.ts`) does NOT create this parameter — it only exports `event-hub/busArn`. Search deploy scripts, CDK custom resources, or SSM manual entries.

- [ ] **Step 2: Remove the parameter source**

Remove the code or configuration that creates this SSM parameter.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: remove investor-hub/table-name SSM parameter — no service should expose internal resources"
```

---

## Task 8: Add ONBOARDING_COMPLETED consumption to investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/src/domain/schemas.ts`
- Create: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
- Create: `services/investor/investor-bff/src/domain/risk-profile.service.ts`
- Test: `services/investor/investor-bff/test/transforms/onboarding-completed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-bff/test/transforms/onboarding-completed.test.ts`:

```typescript
import { computeRiskProfile } from '../../src/domain/risk-profile.service';

describe('computeRiskProfile', () => {
  it('returns conservative for low tolerance + low experience', () => {
    const result = computeRiskProfile(0, 0);
    expect(result.category).toBe('conservative');
    expect(result.tolerance).toBe('hold');
    expect(result.experienceLevel).toBe('novice');
    expect(result.score).toBeLessThan(34);
  });

  it('returns aggressive for high tolerance + high experience', () => {
    const result = computeRiskProfile(3, 3);
    expect(result.category).toBe('aggressive');
    expect(result.score).toBeGreaterThanOrEqual(67);
  });

  it('returns moderate for mixed indices', () => {
    const result = computeRiskProfile(2, 1);
    expect(result.category).toBe('moderate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test investor-bff --testPathPattern=transforms/onboarding-completed
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create risk-profile.service.ts in investor-bff**

Create `services/investor/investor-bff/src/domain/risk-profile.service.ts`:

```typescript
const TOLERANCE_LABELS = ['hold', 'cautious', 'selective', 'aggressive'] as const;
const EXPERIENCE_LABELS = ['novice', 'beginner', 'intermediate', 'expert'] as const;

export interface RiskProfileResult {
  score: number;
  band: { minEquity: number; maxEquity: number };
  tolerance: string;
  experienceLevel: string;
  category: 'conservative' | 'moderate' | 'aggressive';
}

/** Authoritative risk scoring — investor-bff owns this algorithm. */
export function computeRiskProfile(toleranceIdx: number, experienceIdx: number): RiskProfileResult {
  const t = Math.max(0, Math.min(3, Math.round(toleranceIdx)));
  const e = Math.max(0, Math.min(3, Math.round(experienceIdx)));

  const raw = (t * 0.6 + e * 0.4) / 3;
  const score = Math.min(100, Math.round(raw * 100 + 0.5));

  const category = score < 34 ? 'conservative' as const
    : score < 67 ? 'moderate' as const
    : 'aggressive' as const;

  const band = category === 'conservative' ? { minEquity: 0.1, maxEquity: 0.3 }
    : category === 'moderate' ? { minEquity: 0.3, maxEquity: 0.6 }
    : { minEquity: 0.6, maxEquity: 0.9 };

  return {
    score,
    band,
    tolerance: TOLERANCE_LABELS[t],
    experienceLevel: EXPERIENCE_LABELS[e],
    category,
  };
}
```

- [ ] **Step 4: Create onboarding-completed transform**

Create `services/investor/investor-bff/src/transforms/onboarding-completed.ts`:

```typescript
import type { WriteIntent, UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';

interface OnboardingCompletedPayload {
  tenantId: string;
  userId: string;
  goal: { objective: string };
  horizonYears: number;
  accountMode: 'simulation' | 'live';
  capitalAmount: number;
  currency: string;
  riskTolerance: number;
  riskExperience: number;
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  mandateAccepted: true;
}

/**
 * Custom handler — cannot use `record()` helper because we need transactWrite
 * for 6 entities atomically.
 */
export async function onboardingCompleted(
  uow: UnitOfWork<BusEvent<OnboardingCompletedPayload>>,
): Promise<void> {
  const { subject: s } = uow.event;
  const repo = new InvestorProfileRepository(uow.tableName);
  const now = getTime();
  const pk = `InvestorProfile#${s.tenantId}#${s.userId}`;
  const risk = computeRiskProfile(s.riskTolerance, s.riskExperience);
  const goalId = getUUID();
  const mandateId = getUUID();

  await repo.transactWrite({
    TransactItems: [
      // 1. Update InvestorProfile
      {
        Update: {
          TableName: uow.tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: 'SET operatingMode = :mode, onboardingCompletedAt = :now, updatedAt = :now, #ts = :ts',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':mode': s.operatingMode, ':now': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
        },
      },
      // 2. Put Goal
      {
        Put: {
          TableName: uow.tableName,
          Item: {
            pk, sk: `Goal#${goalId}`, __typename: 'Goal',
            tenantId: s.tenantId, timestamp: now, goalId,
            objective: s.goal.objective,
            timeHorizonMonths: s.horizonYears * 12,
            targetAmountCents: 0, currency: s.currency, targetReturn: 0,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 3. Put RiskProfile
      {
        Put: {
          TableName: uow.tableName,
          Item: {
            pk, sk: 'RiskProfile', __typename: 'RiskProfile',
            tenantId: s.tenantId, timestamp: now, profileId: getUUID(),
            score: risk.score, band: risk.band,
            toleranceResponse: risk.tolerance, experienceLevel: risk.experienceLevel,
            assessedAt: now, version: 1,
          } satisfies TableEntry,
        },
      },
      // 4. Put OperatingModeRecord
      {
        Put: {
          TableName: uow.tableName,
          Item: {
            pk, sk: 'OperatingMode', __typename: 'OperatingModeRecord',
            tenantId: s.tenantId, timestamp: now,
            mode: s.operatingMode, selectedAt: now,
          } satisfies TableEntry,
        },
      },
      // 5. Put AccountMode
      {
        Put: {
          TableName: uow.tableName,
          Item: {
            pk, sk: 'AccountMode', __typename: 'AccountMode',
            tenantId: s.tenantId, timestamp: now,
            mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency,
            createdAt: now, updatedAt: now,
          } satisfies TableEntry,
        },
      },
      // 6. Put Mandate
      {
        Put: {
          TableName: uow.tableName,
          Item: {
            pk, sk: 'Mandate', __typename: 'Mandate',
            tenantId: s.tenantId, timestamp: now, mandateId,
            level: 'ADVISORY',
            monthlyTurnoverCapPercent: 10,
            maxSingleTradePercent: 5,
            coolDownDays: 1,
            rebalanceCadence: 'QUARTERLY',
            effectiveDate: now, revokedAt: null, version: 1,
          } satisfies TableEntry,
        },
      },
    ],
  });
}
```

- [ ] **Step 5: Update investor-bff event-listener.ts**

Add the `ONBOARDING_COMPLETED` handler:

```typescript
import { onboardingCompleted } from '../transforms/onboarding-completed';

// In createHandlers():
[InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (payload: any, ctx: any) =>
  onboardingCompleted(toUow(payload, ctx) as any),
```

Note: `onboardingCompleted` returns `void` (not a `WriteIntent`) because it handles its own `transactWrite`. The `materializeToTable` handler in event-processor should handle both patterns — if the handler returns `void`/`undefined`, skip the default materialization. Verify this behavior; if `materializeToTable` requires a `WriteIntent` return, wrap in a `skip()` intent.

- [ ] **Step 6: Update investor-bff service.stack.ts**

Add `'ONBOARDING_COMPLETED'` to the Ingress eventTypes:

```typescript
const ingress = new Ingress(this, 'Ingress', {
  eventTypes: ['USER_REGISTERED', 'NOTIFICATION_CREATED', 'BALANCE_UPDATED', 'ONBOARDING_COMPLETED'],
});
```

- [ ] **Step 7: Update investor-bff domain/schemas.ts**

Replace the slim `OnboardingCompletedSchema` with the raw payload version:

```typescript
export const OnboardingCompletedSchema = BusEventSchema.extend({
  type: z.literal('ONBOARDING_COMPLETED'),
  subject: z.object({
    tenantId: z.string().uuid(),
    userId: z.string().min(1),
    goal: z.object({ objective: z.string() }),
    horizonYears: z.number().int().min(1).max(30),
    accountMode: z.enum(['simulation', 'live']),
    capitalAmount: z.number().nonnegative(),
    currency: z.string().length(3),
    riskTolerance: z.number().int().min(0).max(3),
    riskExperience: z.number().int().min(0).max(3),
    operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
    mandateAccepted: z.literal(true),
  }),
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm nx test investor-bff
```

Expected: PASS (risk-profile test + existing tests)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(investor-bff): consume ONBOARDING_COMPLETED — create all domain entities atomically"
```

---

## Task 9: Remove ONBOARDING_COMPLETED from dashboard-bff

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts` (Ingress eventTypes, if ONBOARDING_COMPLETED is listed)

dashboard-bff already handles `GOAL_SET`/`GOAL_UPDATED` and `RISK_PROFILE_SET`/`RISK_PROFILE_UPDATED` via the `investorSnapshot` transform. After the isolation, investor-bff's transactWrite triggers CDC that fires these events naturally. So dashboard-bff doesn't need to consume `ONBOARDING_COMPLETED` directly — the individual CDC events populate the same InvestorSnapshot fields.

- [ ] **Step 1: Remove ONBOARDING_COMPLETED case from investor-snapshot.ts**

In `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`, remove the `ONBOARDING_COMPLETED` case block. Add `onboardedAt` to the `GOAL_SET` case (using `event.timestamp`) since `GOAL_SET` is the first CDC event after onboarding:

```typescript
case 'GOAL_SET':
case 'GOAL_UPDATED':
  updates.goalType = payload.objective;
  if (event.type === 'GOAL_SET') updates.onboardedAt = event.timestamp;
  break;
```

- [ ] **Step 2: Remove ONBOARDING_COMPLETED handler from event-listener.ts**

In `services/investor/dashboard-bff/src/handlers/event-listener.ts`, remove:

```typescript
[InvestorBffEventTypes.ONBOARDING_COMPLETED]: (payload: any, ctx: any) =>
  investorSnapshot(toUow(payload, ctx)),
```

- [ ] **Step 3: Remove ONBOARDING_COMPLETED from Ingress eventTypes**

If `ONBOARDING_COMPLETED` is in the dashboard-bff Ingress `eventTypes` array in `service.stack.ts`, remove it.

- [ ] **Step 4: Add OPERATING_MODE_SELECTED handling**

dashboard-bff currently gets `operatingMode` only from `ONBOARDING_COMPLETED`. After removal, add a handler for `OPERATING_MODE_SELECTED`:

In `investor-snapshot.ts`, add a case:

```typescript
case 'OPERATING_MODE_SELECTED':
case 'OPERATING_MODE_CHANGED':
  updates.operatingMode = payload.mode;
  break;
```

In `event-listener.ts`, add:

```typescript
[InvestorBffEventTypes.OPERATING_MODE_SELECTED]: (payload: any, ctx: any) =>
  investorSnapshot(toUow(payload, ctx)),
[InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (payload: any, ctx: any) =>
  investorSnapshot(toUow(payload, ctx)),
```

Add `'OPERATING_MODE_SELECTED'` and `'OPERATING_MODE_CHANGED'` to the Ingress eventTypes if not already present.

- [ ] **Step 5: Run dashboard-bff tests**

```bash
pnpm nx test dashboard-bff
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(dashboard-bff): replace ONBOARDING_COMPLETED with individual CDC events"
```

---

## Task 10: Create onboarding-mfe app

**Files:**
- Create: `apps/onboarding-mfe/` (federation config, routes, project.json)
- Move: `apps/investor-mfe/src/app/onboarding/` → `apps/onboarding-mfe/src/app/onboarding/`
- Move: `apps/investor-mfe/src/app/stores/onboarding.store.ts` → `apps/onboarding-mfe/src/app/stores/onboarding.store.ts`

- [ ] **Step 1: Generate the MFE app**

Use the Nx generator to scaffold, following the same pattern as other MFEs:

```bash
pnpm nx g @nx/angular:app onboarding-mfe --directory=apps/onboarding-mfe --style=css --routing=true --standalone=true
```

Adjust generator flags to match existing MFE setup.

- [ ] **Step 2: Add Native Federation config**

Create `apps/onboarding-mfe/federation.config.js` — copy from `apps/investor-mfe/federation.config.js` and change:

```javascript
module.exports = withNativeFederation({
  name: 'onboarding-mfe',
  exposes: {
    './routes': 'apps/onboarding-mfe/src/app/remote-routes.ts',
  },
  shared: { ...sharedFrontendDeps },
  sharedMappings: ['@nestfolio/ui', '@nestfolio/shell'],
  skip: [],
});
```

- [ ] **Step 3: Move onboarding files from investor-mfe**

```bash
mkdir -p apps/onboarding-mfe/src/app/onboarding
mkdir -p apps/onboarding-mfe/src/app/stores

# Move component + renderers + theme
mv apps/investor-mfe/src/app/onboarding/* apps/onboarding-mfe/src/app/onboarding/

# Move onboarding store
mv apps/investor-mfe/src/app/stores/onboarding.store.ts apps/onboarding-mfe/src/app/stores/
```

- [ ] **Step 4: Create remote-routes.ts**

Create `apps/onboarding-mfe/src/app/remote-routes.ts`:

```typescript
import { Routes } from '@angular/router';
import { OnboardingStore } from './stores/onboarding.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingStore],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./onboarding/onboarding-chat.component').then(
            (m) => m.OnboardingChatComponent,
          ),
      },
    ],
  },
];
```

- [ ] **Step 5: Update HttpAgent endpoint in onboarding-chat.component.ts**

The SSE endpoint should point to onboarding-bff's own URL (not investor-bff's proxy). Update the `agentUrl` or API base URL configuration.

- [ ] **Step 6: Verify onboarding-mfe builds**

```bash
pnpm nx build onboarding-mfe
```

Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: create onboarding-mfe with moved onboarding UI from investor-mfe"
```

---

## Task 11: Clean up investor-mfe — remove onboarding code

**Files:**
- Modify: `apps/investor-mfe/src/app/remote-routes.ts`
- Delete: `apps/investor-mfe/src/app/onboarding/` (already moved)
- Delete: `apps/investor-mfe/src/app/stores/onboarding.store.ts` (already moved)

- [ ] **Step 1: Update investor-mfe remote-routes.ts**

Remove OnboardingStore provider and onboarding route:

```typescript
import { Routes } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [NotificationService, NotificationStore],
    children: [
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notification-list.component').then(
            (m) => m.NotificationListComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
```

- [ ] **Step 2: Verify investor-mfe builds**

```bash
pnpm nx build investor-mfe
```

Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor(investor-mfe): remove onboarding code — moved to onboarding-mfe"
```

---

## Task 12: Add onboarding guards and shell routing

**Files:**
- Create: `libs/shell/src/auth/onboarding.guard.ts`
- Modify: `libs/shell/src/index.ts`
- Modify: `libs/shell/src/models.ts`
- Modify: `apps/nestfolio-host/src/app/app.routes.ts`

- [ ] **Step 1: Add onboardingCompletedAt to UserProfile**

In `libs/shell/src/models.ts`:

```typescript
export interface UserProfile {
  userId: string;
  username: string;
  email: string;
  tenantId: string;
  name?: string;
  onboardingCompletedAt?: string | null;
}
```

- [ ] **Step 2: Create onboarding guards**

Create `libs/shell/src/auth/onboarding.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

/** Allows access only if the user has NOT completed onboarding. */
export const onboardingPendingGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const user = authStore.user();

  if (!user) return router.createUrlTree(['/login']);
  if (user.onboardingCompletedAt) return router.createUrlTree(['/dashboard']);
  return true;
};

/** Allows access only if the user HAS completed onboarding. */
export const onboardingCompletedGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const user = authStore.user();

  if (!user) return router.createUrlTree(['/login']);
  if (!user.onboardingCompletedAt) return router.createUrlTree(['/onboarding']);
  return true;
};
```

- [ ] **Step 3: Export guards from shell**

Add to `libs/shell/src/auth/index.ts` (or wherever auth exports are):

```typescript
export { onboardingPendingGuard, onboardingCompletedGuard } from './onboarding.guard';
```

And ensure `libs/shell/src/index.ts` re-exports them (check existing `export * from './auth'` or add explicitly).

- [ ] **Step 4: Update shell app.routes.ts**

```typescript
import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard } from '@nestfolio/shell/auth';
import { onboardingPendingGuard, onboardingCompletedGuard } from '@nestfolio/shell/auth';
import { MfeErrorComponent } from './mfe-error.component';
import { provideGraphqlFor } from './provide-graphql';

function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule).catch(() => ({
      remoteRoutes: [{ path: '**', component: MfeErrorComponent }],
    }));
}

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'confirm',
    loadComponent: () => import('./auth/confirm.component').then((m) => m.ConfirmComponent),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, onboardingPendingGuard],
    loadChildren: loadMfe('onboarding-mfe', './routes'),
  },
  {
    path: 'investor',
    providers: [provideGraphqlFor('investorBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideGraphqlFor('dashboardBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideGraphqlFor('advisoryBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideGraphqlFor('ledgerBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('ledger-mfe', './routes'),
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
```

- [ ] **Step 5: Build the shell**

```bash
pnpm nx build nestfolio-host
```

Expected: BUILD SUCCESS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(shell): add onboarding guards and /onboarding route for onboarding-mfe"
```

---

## Task 13: Update onboarding-bff existing tests for new model

**Files:**
- Modify: all test files in `services/investor/onboarding-bff/test/`

- [ ] **Step 1: Audit all test files**

List all tests:
```bash
find services/investor/onboarding-bff/test -name '*.test.ts'
```

Update tests that reference old schemas or repository methods:
- `test/tools/commit-phase.test.ts` — update mocks for `updatePhase`/`completeSession` instead of `commitGoal`/`commitHorizon`/etc.
- `test/agent/state.test.ts` — update if it imports `RiskProfileDataSchema`
- `test/agent/session.test.ts` — update for single-argument `rehydrateState`
- `test/domain/schemas.test.ts` — already rewritten in Task 2
- `test/repositories/onboarding.repository.test.ts` — already rewritten in Task 3
- `test/tools/compute-risk.test.ts` — keep as-is (display-only compute still exists)
- `test/tools/render-ui.test.ts` — no changes needed
- `test/tools/search-kb.test.ts` — no changes needed
- `test/agent/router.test.ts` — no changes if it only tests phase routing
- `test/agent/graph.test.ts` — may need mock updates for new tool signatures

- [ ] **Step 2: Fix all broken tests**

Run the full suite, fix one file at a time:

```bash
pnpm nx test onboarding-bff 2>&1 | head -50
```

- [ ] **Step 3: All tests pass**

```bash
pnpm nx test onboarding-bff
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(onboarding-bff): update all tests for OnboardingSession aggregate model"
```

---

## Task 14: Enrich AuthStore with onboarding status at login

**Files:**
- Modify: `libs/shell/src/auth/auth.service.ts` (or wherever profile is fetched at login)
- Modify: `libs/shell/src/stores/auth.store.ts` (if needed)

- [ ] **Step 1: Verify how UserProfile is populated**

Read `libs/shell/src/auth/auth.service.ts` to understand how user profile data is fetched after authentication. The `onboardingCompletedAt` field needs to be included in the profile data returned at login.

- [ ] **Step 2: Add onboardingCompletedAt to profile fetch**

The exact change depends on how the profile is fetched:
- If from Cognito attributes: add a custom attribute `custom:onboardingCompletedAt`
- If from a GraphQL query (e.g., `getProfile`): the field already exists in investor-bff's InvestorProfile entity — just map it to the UserProfile type
- If from a JWT claim: add it to the token

Update the mapping in `auth.service.ts` so that `setAuthenticated(user)` includes `onboardingCompletedAt`.

- [ ] **Step 3: Test login flow**

Verify that after login, `authStore.user().onboardingCompletedAt` is either `null` (not onboarded) or a date string (onboarded).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(shell): include onboardingCompletedAt in user profile at login"
```

---

## Task 15: End-to-end verification

- [ ] **Step 1: Run all affected tests**

```bash
pnpm nx run-many -t test -p onboarding-bff investor-bff dashboard-bff shell
```

Expected: ALL PASS

- [ ] **Step 2: Run all affected lints**

```bash
pnpm nx run-many -t lint -p onboarding-bff investor-bff dashboard-bff onboarding-mfe investor-mfe nestfolio-host shell
```

Expected: ALL PASS

- [ ] **Step 3: Run all affected builds**

```bash
pnpm nx run-many -t build -p onboarding-bff investor-bff dashboard-bff onboarding-mfe investor-mfe nestfolio-host
```

Expected: ALL BUILD SUCCESS

- [ ] **Step 4: Verify CDK synth for both services**

```bash
pnpm nx run-many -t cdk-synth -p onboarding-bff investor-bff dashboard-bff
```

Expected: no errors, Egress construct present in onboarding-bff template, Ingress updated in investor-bff template.

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "chore: verify onboarding isolation — all tests, builds, and synth pass"
```
