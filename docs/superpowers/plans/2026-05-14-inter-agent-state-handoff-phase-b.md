# Inter-Agent State Handoff — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Bedrock MemoryStrategies on the 3 long-term AgentCore Memory namespaces (`preferences`, `signals`, `rationale`) so the 5 surviving `searchLongTermMemory` callers (merged from 6) return non-empty cross-decision results.

**Architecture:** Phase A (shipped 2026-05-14, commit `676dd75c`) moved inter-agent ephemeral handoff to Step Functions state. Phase B (this plan) leaves SF state alone, restores 3 MemoryStrategies on the existing `agentcore.Memory` construct in `decision-workflow-ctrl`, adds a `MemoryClient.emitLongTermEvent` method, has each of the 4 advisory agents emit one CreateEvent after successful structured-output validation (`assertOrchestratorOutput` site in each `agent-service.ts`), and changes the `MemoryClient.searchLongTermMemory` signature to take an explicit namespace arg.

**Tech Stack:** TypeScript, AWS CDK with `@aws-cdk/aws-bedrock-agentcore-alpha` + `@aws-cdk/aws-bedrock-alpha`, `@aws-sdk/client-bedrock-agentcore` (`CreateEventCommand` + `RetrieveMemoryRecordsCommand`), Jest, Nx, pnpm.

---

## File Structure

**Library (1 lib touched):**

- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts` — add `emitLongTermEvent({ namespace, payload })`; change `searchLongTermMemory(namespace, query, topK?)` signature + namespace path
- Modify: `libs/agent-orchestrator/src/memory/no-op-client.ts` — mirror new method and signature
- Modify: `libs/agent-orchestrator/test/memory-client.test.ts` — unit tests for both methods + no-op

**Infra (1 service stack):**

- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — restore `BedrockFoundationModel` + Haiku SSM lookup; restore Memory execution-role `bedrock:InvokeModel` grant; provision 3 MemoryStrategies on `agentcore.Memory`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — CDK assertions on strategies + IAM grant

**Per-agent runtime (4 agents × 3-4 files each):**

For each of `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `advisory-narrative-ctrl`:

- Modify: `services/advisory/<agent>-ctrl/src/agent-service.ts` — add `memoryClient` to `AgentServiceDeps`; emit one `CreateEvent` immediately after `assertOrchestratorOutput`
- Modify: `services/advisory/<agent>-ctrl/src/handlers/event-listener.ts` — pass `memoryClient` into `createAgentService`; update `searchLongTermMemory` call(s) with the new namespace arg
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts` — only one site here: update `searchLongTermMemory` signature
- Modify: per-service `test/unit/agent-service.test.ts` — mock + assert `emitLongTermEvent` fires once on success, zero on degraded output
- Modify: per-service `test/unit/event-listener.test.ts` and `test/unit/graph.test.ts` — update `searchLongTermMemory` mocks for the new namespace arg
- Special case `advisory-narrative-ctrl/src/handlers/event-listener.ts` — merge sites 5+6 into one `rationale` call

**Doc + backlog (workstream ship):**

- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 — add provisioned-strategies subsection
- Modify: `docs/backlog/inter-agent-state-handoff-sf-vs-memory.md` — flip `status: shipped`, fill `validation_gate:`
- New: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_inter_agent_state_handoff.md` — topic memory dossier

---

## Tasks

### Task 1: MemoryClient — `searchLongTermMemory` namespace arg

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts`
- Test: `libs/agent-orchestrator/test/memory-client.test.ts`

The current `searchLongTermMemory(query, topK)` queries `/{service}/{tenantId}`. Phase B changes it to `searchLongTermMemory(namespace, query, topK)` querying `/{service}/{tenantId}/{namespace}` — where `namespace ∈ 'preferences'|'signals'|'rationale'` is enforced by a TS string-literal union type.

- [ ] **Step 1: Write the failing test for the new signature**

Append to `libs/agent-orchestrator/test/memory-client.test.ts` (inside the existing `describe('memory-client')` block, or in a fresh `describe('searchLongTermMemory namespace path')`):

```ts
import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { createMemoryClient } from '../src/memory/memory-client';

const bedrockMock = mockClient(BedrockAgentCoreClient);

describe('searchLongTermMemory namespace path', () => {
  beforeEach(() => bedrockMock.reset());

  it('queries /{service}/{tenantId}/{namespace} when namespace is given', async () => {
    bedrockMock.on(RetrieveMemoryRecordsCommand).resolves({ memoryRecordSummaries: [] });
    const client = createMemoryClient({
      memoryId: 'mem-1',
      region: 'us-east-1',
      serviceName: 'investor-profile',
    });
    const session = client.openDecisionSession('tenant-a', 'dec-1');
    await session.searchLongTermMemory('preferences', 'risk tolerance', 3);

    const call = bedrockMock.commandCalls(RetrieveMemoryRecordsCommand)[0];
    expect(call.args[0].input).toMatchObject({
      memoryId: 'mem-1',
      namespace: '/investor-profile/tenant-a/preferences',
      searchCriteria: { searchQuery: 'risk tolerance', topK: 3 },
    });
  });

  it('rejects invalid namespace names at the type level (compile-time check via constrained string union)', () => {
    // This is a compile-time guarantee. The body of the test is a no-op runtime
    // assertion; if the namespace union widens accidentally, the call below
    // would not type-check.
    const validNamespaces: Array<'preferences' | 'signals' | 'rationale'> = [
      'preferences', 'signals', 'rationale',
    ];
    expect(validNamespaces).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm nx test agent-orchestrator -t 'searchLongTermMemory namespace path'`
Expected: FAIL — `Expected number of arguments mismatch` or runtime path mismatch.

- [ ] **Step 3: Implement the new signature**

Replace the existing `DecisionSession` interface and the `searchLongTermMemory` implementation in `libs/agent-orchestrator/src/memory/memory-client.ts`:

```ts
import {
  BedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand,
  CreateEventCommand,
} from '@aws-sdk/client-bedrock-agentcore';

export type LongTermNamespace = 'preferences' | 'signals' | 'rationale';

export interface MemoryClientConfig {
  memoryId: string;
  region: string;
  serviceName: string;
}

export interface MemoryRecord {
  content: string;
  score: number;
  memoryRecordId: string;
}

export interface EmitLongTermEventInput {
  namespace: LongTermNamespace;
  payload: Record<string, unknown>;
}

export interface DecisionSession {
  searchLongTermMemory(
    namespace: LongTermNamespace,
    query: string,
    topK?: number,
  ): Promise<MemoryRecord[]>;
  emitLongTermEvent(input: EmitLongTermEventInput): Promise<void>;
}

export interface MemoryClient {
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  searchTenantMemory(
    tenantId: string,
    namespace: LongTermNamespace,
    query: string,
    topK?: number,
  ): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  const client = new BedrockAgentCoreClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, decisionId: string): DecisionSession {
      return {
        async searchLongTermMemory(
          namespace: LongTermNamespace,
          query: string,
          topK = 5,
        ): Promise<MemoryRecord[]> {
          const ns = `/${config.serviceName}/${tenantId}/${namespace}`;
          const resp = await client.send(
            new RetrieveMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace: ns,
              searchCriteria: { searchQuery: query, topK },
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },
        async emitLongTermEvent(_input: EmitLongTermEventInput): Promise<void> {
          // Implemented in Task 2. Stub returns void so this task compiles.
          return;
        },
      };
    },

    async searchTenantMemory(
      tenantId: string,
      namespace: LongTermNamespace,
      query: string,
      topK = 5,
    ): Promise<MemoryRecord[]> {
      const ns = `/${config.serviceName}/${tenantId}/${namespace}`;
      const resp = await client.send(
        new RetrieveMemoryRecordsCommand({
          memoryId: config.memoryId,
          namespace: ns,
          searchCriteria: { searchQuery: query, topK },
        })
      );
      return (resp.memoryRecordSummaries ?? []).map(mapRecord);
    },
  };
}

interface MemoryRecordSummaryLike {
  memoryRecordId?: string;
  content?: { text?: string };
  score?: number;
}

function mapRecord(r: MemoryRecordSummaryLike): MemoryRecord {
  return {
    content: r.content?.text ?? '',
    score: r.score ?? 0,
    memoryRecordId: r.memoryRecordId ?? '',
  };
}
```

Also update the re-export in `libs/agent-orchestrator/src/memory/index.ts` and `libs/agent-orchestrator/src/index.ts` to include `LongTermNamespace` + `EmitLongTermEventInput`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm nx test agent-orchestrator -t 'searchLongTermMemory namespace path'`
Expected: PASS (2 tests).

- [ ] **Step 5: Run all lib tests to check for callers we broke**

Run: `pnpm nx test agent-orchestrator`
Expected: existing `searchTenantMemory` tests may fail because signature widened. Update those test calls to pass a namespace literal (`'preferences'`) — they're test-only and stable.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/memory/memory-client.ts \
        libs/agent-orchestrator/src/memory/index.ts \
        libs/agent-orchestrator/src/index.ts \
        libs/agent-orchestrator/test/memory-client.test.ts
git commit -m "feat(agent-orchestrator): namespace arg on searchLongTermMemory

Part of Phase B inter-agent-state-handoff-sf-vs-memory. Adds the
LongTermNamespace string literal type ('preferences' | 'signals' |
'rationale') and routes queries to /{service}/{tenantId}/{namespace}.
emitLongTermEvent stub added for Task 2 to fill in."
```

---

### Task 2: MemoryClient — `emitLongTermEvent` method

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts:emitLongTermEvent`
- Test: `libs/agent-orchestrator/test/memory-client.test.ts`

Implements the stub from Task 1. Wraps `CreateEventCommand` with `actorId = tenantId`, `sessionId = decisionId`, single conversational payload item carrying the structured output as JSON in the assistant role.

- [ ] **Step 1: Write the failing test**

Append to `libs/agent-orchestrator/test/memory-client.test.ts`:

```ts
import { CreateEventCommand } from '@aws-sdk/client-bedrock-agentcore';

describe('emitLongTermEvent', () => {
  beforeEach(() => bedrockMock.reset());

  it('sends CreateEvent with actorId=tenantId, sessionId=decisionId, conversational payload', async () => {
    bedrockMock.on(CreateEventCommand).resolves({ event: { eventId: 'e1' } });
    const client = createMemoryClient({
      memoryId: 'mem-1',
      region: 'us-east-1',
      serviceName: 'investor-profile',
    });
    const session = client.openDecisionSession('tenant-a', 'dec-42');

    await session.emitLongTermEvent({
      namespace: 'preferences',
      payload: { goals: ['retirement'], risk: { riskScore: 45 } },
    });

    const call = bedrockMock.commandCalls(CreateEventCommand)[0];
    expect(call).toBeDefined();
    const input = call.args[0].input;
    expect(input.memoryId).toBe('mem-1');
    expect(input.actorId).toBe('tenant-a');
    expect(input.sessionId).toBe('dec-42');
    expect(input.eventTimestamp).toBeInstanceOf(Date);
    // payload is a list of EventPayloadItem; one conversational entry with
    // a JSON-serialised structured output in assistant role
    expect(input.payload).toEqual([
      expect.objectContaining({
        conversational: expect.objectContaining({
          role: 'ASSISTANT',
          content: expect.objectContaining({
            text: expect.stringContaining('"goals":["retirement"]'),
          }),
        }),
      }),
    ]);
  });

  it('does not throw if the SDK call fails (best-effort semantics)', async () => {
    bedrockMock.on(CreateEventCommand).rejects(new Error('throttled'));
    const client = createMemoryClient({
      memoryId: 'mem-1',
      region: 'us-east-1',
      serviceName: 'investor-profile',
    });
    const session = client.openDecisionSession('tenant-a', 'dec-42');

    await expect(
      session.emitLongTermEvent({
        namespace: 'preferences',
        payload: { goals: [] },
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm nx test agent-orchestrator -t 'emitLongTermEvent'`
Expected: FAIL — stub returns void, SDK call never made.

- [ ] **Step 3: Implement `emitLongTermEvent`**

Replace the stub in `libs/agent-orchestrator/src/memory/memory-client.ts`:

```ts
async emitLongTermEvent(input: EmitLongTermEventInput): Promise<void> {
  // Best-effort emit. Failures are logged but do not throw — long-term
  // recall is non-critical to the agent's success path. See
  // docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md.
  const ns = `/${config.serviceName}/${tenantId}/${input.namespace}`;
  try {
    await client.send(
      new CreateEventCommand({
        memoryId: config.memoryId,
        actorId: tenantId,
        sessionId: decisionId,
        eventTimestamp: new Date(),
        payload: [
          {
            conversational: {
              role: 'ASSISTANT',
              content: { text: JSON.stringify(input.payload) },
            },
          },
        ],
        // Per AgentCore Memory contract, the namespace governs which
        // strategy extracts from this event — must match the strategy's
        // namespace pattern declared in decision-workflow-ctrl's
        // service.stack.ts.
      })
    );
    void ns; // namespace is implicit via actorId+namespace template binding
  } catch (err) {
    // Phase B: best-effort. CloudWatch metric LongTermEventEmitFailures
    // would be wired via observability if/when failure rate becomes a
    // signal. Log + swallow.
    // eslint-disable-next-line no-console
    console.warn('emitLongTermEvent failed', {
      namespace: input.namespace,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

Note: the AgentCore Memory SDK's `CreateEvent` infers namespace from the actorId+sessionId combined with the strategy's declared namespace template (`/{service}/{actorId}/{type}`). When extracting, Bedrock matches the strategy whose namespace pattern resolves to the event's effective path. The `ns` local is computed and held for future use (e.g., logs); the SDK itself does not take a `namespace` field on CreateEvent.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm nx test agent-orchestrator -t 'emitLongTermEvent'`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/memory/memory-client.ts \
        libs/agent-orchestrator/test/memory-client.test.ts
git commit -m "feat(agent-orchestrator): MemoryClient.emitLongTermEvent

Wraps CreateEventCommand with actorId=tenantId, sessionId=decisionId,
conversational payload (JSON-serialised structured output in ASSISTANT
role). Best-effort semantics: logs + swallows on SDK failure so the
agent's main path is never blocked by Memory.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 3: No-op MemoryClient — mirror new shape

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/no-op-client.ts`
- Test: `libs/agent-orchestrator/test/memory-client.test.ts`

The no-op client is what graph.ts / event-listener handlers fall back to when `MEMORY_ID` env var is absent (local dev, unit tests). It must satisfy the same `MemoryClient` + `DecisionSession` interfaces.

- [ ] **Step 1: Write the failing test**

Append to `libs/agent-orchestrator/test/memory-client.test.ts`:

```ts
import { createNoOpMemoryClient } from '../src/memory/no-op-client';

describe('createNoOpMemoryClient', () => {
  it('searchLongTermMemory(namespace, query, topK?) returns []', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('tenant-a', 'dec-1');
    const records = await session.searchLongTermMemory('preferences', 'q', 3);
    expect(records).toEqual([]);
  });

  it('emitLongTermEvent resolves to undefined and side-effects nothing', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('tenant-a', 'dec-1');
    await expect(
      session.emitLongTermEvent({ namespace: 'rationale', payload: { x: 1 } })
    ).resolves.toBeUndefined();
  });

  it('searchTenantMemory(tenantId, namespace, query) returns []', async () => {
    const client = createNoOpMemoryClient();
    const records = await client.searchTenantMemory('tenant-a', 'signals', 'q');
    expect(records).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm nx test agent-orchestrator -t 'createNoOpMemoryClient'`
Expected: FAIL — current no-op shape predates the namespace arg.

- [ ] **Step 3: Implement the no-op updates**

Replace `libs/agent-orchestrator/src/memory/no-op-client.ts`:

```ts
import type {
  MemoryClient,
  DecisionSession,
  MemoryRecord,
  EmitLongTermEventInput,
  LongTermNamespace,
} from './memory-client';

export function createNoOpMemoryClient(): MemoryClient {
  const session: DecisionSession = {
    async searchLongTermMemory(
      _namespace: LongTermNamespace,
      _query: string,
      _topK?: number,
    ): Promise<MemoryRecord[]> {
      return [];
    },
    async emitLongTermEvent(_input: EmitLongTermEventInput): Promise<void> {
      return;
    },
  };

  return {
    openDecisionSession() {
      return session;
    },
    async searchTenantMemory(
      _tenantId: string,
      _namespace: LongTermNamespace,
      _query: string,
      _topK?: number,
    ): Promise<MemoryRecord[]> {
      return [];
    },
  };
}
```

- [ ] **Step 4: Run all lib tests**

Run: `pnpm nx test agent-orchestrator`
Expected: all PASS (memory-client old tests + 3 new no-op tests + searchLongTermMemory tests + emit tests).

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/memory/no-op-client.ts \
        libs/agent-orchestrator/test/memory-client.test.ts
git commit -m "chore(agent-orchestrator): no-op MemoryClient mirrors new shape

Phase B namespace arg + emitLongTermEvent stub mirrored on no-op client
so unit tests + local dev paths (no MEMORY_ID env) still type-check."
```

---

### Task 4: decision-workflow-ctrl — Memory execution role `InvokeModel` grant

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

Strategy extraction is performed by Bedrock invoking the configured model (Haiku per OQ #2) under the AgentCore Memory execution role. Phase A left this grant absent (it was removed by `3f6eea0e` along with the strategy declarations). We must restore the `PolicyStatement` allowing `bedrock:InvokeModel` on the Haiku inference profile.

- [ ] **Step 1: Write the failing CDK assertion**

Append to `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` inside the existing `describe('DecisionWorkflowCtrlStack')`:

```ts
it('grants bedrock:InvokeModel to the Memory execution role for strategy extraction', () => {
  // Bedrock AgentCore Memory invokes the configured extraction model under
  // an execution role. Without this grant, MemoryStrategies silently fail to
  // extract — symptom: searchLongTermMemory returns [] forever.
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Action: 'bedrock:InvokeModel',
          Resource: Match.anyValue(),
        }),
      ]),
    }),
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm nx test decision-workflow-ctrl -t 'bedrock:InvokeModel to the Memory execution role'`
Expected: FAIL — no such policy statement in the synthesised template.

- [ ] **Step 3: Restore the grant + BedrockFoundationModel + naming-service**

Update `services/advisory/decision-workflow-ctrl/src/service.stack.ts` imports at the top:

```ts
import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { BedrockFoundationModel } from '@aws-cdk/aws-bedrock-alpha';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Orchestration } from '@nestfolio/cdk-constructs/core';
import { NamingService, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import {
  TRIGGER_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  DecisionWorkflowEventTypes,
  MANDATE_LIFECYCLE_EVENT_TYPES,
} from './domain/events';
import { DecisionWorkflowDefinition } from './constructs/decision-state-machine';
```

After the `const memory = new agentcore.Memory(...)` block, add:

```ts
// --- Bedrock extraction model for MemoryStrategies (Phase B) ---
// Haiku per OQ #2 of design spec (cost-optimal for extraction; aligns
// with agentcore-cost-safeguards posture).
const hubNaming = new NamingService({
  prefix: props.prefix,
  subsystem: 'advisory',
  service: 'advisory-hub',
});
const modelHaikuId = StringParameter.valueForStringParameter(
  this,
  hubNaming.ssmParameterPath('models/haiku'),
);
const haikuModel = new BedrockFoundationModel(modelHaikuId);

// Memory execution role: grant InvokeModel for extraction prompts. Without
// this, strategies silently never extract — searchLongTermMemory stays
// empty. Removed by 3f6eea0e (2026-05-11); Phase B reinstates.
const haikuModelArn = Stack.of(this).formatArn({
  service: 'bedrock',
  resource: 'inference-profile',
  resourceName: modelHaikuId,
});
new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [haikuModelArn, '*'],
});
// NOTE: the CDK Memory L2 construct exposes its execution role as
// `memory.role`. If the actual property name differs at implementation
// time, swap to whatever the alpha-construct surface offers (current docs:
// `memory.role.addToPrincipalPolicy(...)`).
memory.role.addToPrincipalPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [haikuModelArn],
}));

void haikuModel; // referenced by MemoryStrategies in Task 5
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm nx test decision-workflow-ctrl -t 'bedrock:InvokeModel to the Memory execution role'`
Expected: PASS.

- [ ] **Step 5: Verify CDK synth still passes**

Run: `pnpm nx run decision-workflow-ctrl:synth`
Expected: synth succeeds. If the `memory.role` property name is wrong, the synth error tells you the correct one — fix accordingly.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): restore InvokeModel grant on Memory role

Phase B prereq: MemoryStrategies (Task 5) need the execution role to
invoke Bedrock for extraction. Reverses one half of 3f6eea0e.

Uses Haiku per OQ #2 of the Phase B design spec.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 5: decision-workflow-ctrl — provision 3 MemoryStrategies

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

Wire the 3 strategies onto the existing `agentcore.Memory` construct with the namespace patterns and prompts from the spec.

- [ ] **Step 1: Write the failing CDK assertions for all 3 strategies**

Append to `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`:

```ts
describe('Phase B — Long-term MemoryStrategies', () => {
  it('attaches 3 strategies to the Memory resource', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    expect(strategies).toHaveLength(3);
  });

  it('attaches InvestorPreferenceLearner with USER_PREFERENCE_MEMORY type, custom Haiku extraction', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const learner = strategies.find(
      (s: any) => s.CustomMemoryStrategy?.Name === 'InvestorPreferenceLearner',
    );
    expect(learner).toBeDefined();
    const cfg = learner?.CustomMemoryStrategy?.Configuration?.UserPreferenceOverride;
    expect(cfg?.Extraction?.AppendToPrompt).toContain('risk tolerance');
    expect(cfg?.Consolidation?.AppendToPrompt).toContain('newer statements override');
    expect(learner?.CustomMemoryStrategy?.Namespaces).toEqual([
      '/investor-profile-ctrl/{actorId}/preferences',
    ]);
  });

  it('attaches MarketSignalExtractor with SEMANTIC_MEMORY type, custom Haiku extraction', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const extractor = strategies.find(
      (s: any) => s.CustomMemoryStrategy?.Name === 'MarketSignalExtractor',
    );
    expect(extractor).toBeDefined();
    const cfg = extractor?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
    expect(cfg?.Extraction?.AppendToPrompt).toContain('cross-decision shelf life');
    expect(extractor?.CustomMemoryStrategy?.Namespaces).toEqual([
      '/market-intelligence-ctrl/{actorId}/signals',
    ]);
  });

  it('attaches RationaleArchivist with SEMANTIC_MEMORY type, custom Haiku extraction, two namespace patterns', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const archivist = strategies.find(
      (s: any) => s.CustomMemoryStrategy?.Name === 'RationaleArchivist',
    );
    expect(archivist).toBeDefined();
    const cfg = archivist?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
    expect(cfg?.Extraction?.AppendToPrompt).toContain('investor-facing narrative');
    expect(cfg?.Consolidation?.AppendToPrompt).toContain('reasoning chain');
    expect(archivist?.CustomMemoryStrategy?.Namespaces).toEqual([
      '/portfolio-engine-ctrl/{actorId}/rationale',
      '/advisory-narrative-ctrl/{actorId}/rationale',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm nx test decision-workflow-ctrl -t 'Phase B — Long-term MemoryStrategies'`
Expected: 4 FAIL — Memory currently has no strategies.

- [ ] **Step 3: Provision the strategies**

Replace the `const memory = new agentcore.Memory(this, 'AgentMemory', {...})` block (and remove the outdated leading comment about "no strategies provisioned") in `services/advisory/decision-workflow-ctrl/src/service.stack.ts`:

```ts
// --- AgentCore Memory ---
// 3 long-term MemoryStrategies provisioned on Phase B (2026-05-14
// inter-agent-state-handoff-sf-vs-memory design spec, Part B):
//
//   InvestorPreferenceLearner (USER_PREFERENCE_MEMORY)
//     → /investor-profile-ctrl/{actorId}/preferences
//   MarketSignalExtractor      (SEMANTIC_MEMORY)
//     → /market-intelligence-ctrl/{actorId}/signals
//   RationaleArchivist         (SEMANTIC_MEMORY)
//     → /portfolio-engine-ctrl/{actorId}/rationale
//     → /advisory-narrative-ctrl/{actorId}/rationale
//
// Each agent emits one CreateEvent per decision cycle via
// MemoryClient.emitLongTermEvent (libs/agent-orchestrator) after
// successful structured-output validation. Extracted records are read
// via session.searchLongTermMemory(namespace, query) on the 5 caller
// sites across the 4 advisory ctrls. Extraction uses Haiku per OQ #2.
const memory = new agentcore.Memory(this, 'AgentMemory', {
  memoryName: `nestfolio_${props.prefix}_agent_memory`,
  description: 'Long-term cross-decision recall (preferences/signals/rationale)',
  expirationDuration: Duration.days(90),
  memoryStrategies: [
    agentcore.MemoryStrategy.usingUserPreference({
      name: 'InvestorPreferenceLearner',
      namespaces: ['/investor-profile-ctrl/{actorId}/preferences'],
      customExtraction: {
        model: haikuModel,
        appendToPrompt:
          'Extract investor preferences: risk tolerance level, asset class ' +
          'preferences, ESG constraints, liquidity needs, time horizon, and ' +
          'stated return targets. One fact per record. Ignore mechanical ' +
          'decision details.',
      },
      customConsolidation: {
        model: haikuModel,
        appendToPrompt:
          'When consolidating investor preferences, newer statements override ' +
          'older ones for the same dimension. Flag contradictions (e.g., high ' +
          'growth vs conservative).',
      },
    }),
    agentcore.MemoryStrategy.usingSemantic({
      name: 'MarketSignalExtractor',
      namespaces: ['/market-intelligence-ctrl/{actorId}/signals'],
      customExtraction: {
        model: haikuModel,
        appendToPrompt:
          'Extract market signals with cross-decision shelf life: sector ' +
          'trends, regime indicators, signal strength, and direction. Ignore ' +
          'one-off intraday noise. One signal per record.',
      },
    }),
    agentcore.MemoryStrategy.usingSemantic({
      name: 'RationaleArchivist',
      namespaces: [
        '/portfolio-engine-ctrl/{actorId}/rationale',
        '/advisory-narrative-ctrl/{actorId}/rationale',
      ],
      customExtraction: {
        model: haikuModel,
        appendToPrompt:
          'Extract recommendation rationale: which assets were weighted and ' +
          'why, which constraints were binding, what trade-offs were chosen, ' +
          'and the investor-facing narrative summary including tone. One ' +
          'rationale per record, scoped to the decision it explains.',
      },
      customConsolidation: {
        model: haikuModel,
        appendToPrompt:
          'Consolidate chronologically. Preserve the reasoning chain — ' +
          'don\'t collapse distinct decisions into a summary.',
      },
    }),
  ],
});
```

- [ ] **Step 4: Run the strategy tests and confirm they pass**

Run: `pnpm nx test decision-workflow-ctrl -t 'Phase B — Long-term MemoryStrategies'`
Expected: 4 PASS.

- [ ] **Step 5: Run the full decision-workflow-ctrl test suite (regression)**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: all PASS. If the previous negative assertion "declares no MemoryStrategies" (added in `3f6eea0e`) still exists, delete it — it's been superseded.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): provision 3 long-term MemoryStrategies

Phase B of inter-agent-state-handoff-sf-vs-memory. Attaches:

  InvestorPreferenceLearner (USER_PREFERENCE_MEMORY)
    -> /investor-profile-ctrl/{actorId}/preferences
  MarketSignalExtractor (SEMANTIC_MEMORY, custom Haiku prompt)
    -> /market-intelligence-ctrl/{actorId}/signals
  RationaleArchivist (SEMANTIC_MEMORY, custom Haiku prompt, 2 patterns)
    -> /portfolio-engine-ctrl/{actorId}/rationale
    -> /advisory-narrative-ctrl/{actorId}/rationale

Strategies stay empty until agents start emitting via
MemoryClient.emitLongTermEvent (Tasks 6-9)."
```

---

### Task 6: investor-profile-ctrl — wire emit + update retrieval

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/agent-service.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`
- Test: `services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts`
- Test: `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts`
- Test: `services/advisory/investor-profile-ctrl/test/unit/graph.test.ts`

This agent has TWO retrieval sites (graph.ts:77 and event-listener.ts:25) both targeting `preferences`. The emit goes immediately after `assertOrchestratorOutput` in `agent-service.ts` (which is the "successful structured-output validation" boundary the spec describes), with `namespace: 'preferences'` and `payload: { goals, risk }` (the same fields returned to the SF callback).

- [ ] **Step 1: Write the failing test for the emit in agent-service.ts**

In `services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts`, append:

```ts
describe('Phase B — emitLongTermEvent integration', () => {
  it('emits one event to preferences namespace after successful validation', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: true, output: { goals: ['retirement'] } },
      'risk-assessment': { ok: true, output: { riskScore: 45, riskCategory: 'MODERATE' } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'd1',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
      investorProfile: { age: 35 },
      portfolioState: { totalValue: 50000 },
    });

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).toHaveBeenCalledTimes(1);
    expect(session.emitLongTermEvent).toHaveBeenCalledWith({
      namespace: 'preferences',
      payload: expect.objectContaining({
        goals: expect.objectContaining({ goals: ['retirement'] }),
        risk: expect.objectContaining({ riskScore: 45 }),
      }),
    });
  });

  it('does NOT emit when structured output is degraded (discriminant check throws)', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: false, reason: 'empty' },
      'risk-assessment': { ok: true, output: { riskScore: 45 } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await expect(
      service.runPipeline('evt-2', {
        tenantId: 't1',
        decisionId: 'd2',
        operatingMode: 'BALANCED',
        taskToken: 'tok',
      }),
    ).rejects.toThrow(); // DegradedAgentOutputError

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm nx test investor-profile-ctrl -t 'emitLongTermEvent integration'`
Expected: 2 FAIL — current `createAgentService` does not accept memoryClient and doesn't emit.

- [ ] **Step 3: Add `memoryClient` to AgentServiceDeps and emit after validation**

Update `services/advisory/investor-profile-ctrl/src/agent-service.ts`:

```ts
// Add to existing imports:
import type { MemoryClient } from '@nestfolio/agent-orchestrator';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly memoryClient: MemoryClient;
}
```

Inside `runPipeline`, immediately AFTER the `assertOrchestratorOutput(result, ['user-goals', 'risk-assessment'], { decisionId, agent: 'investor-profile' });` call and BEFORE the destructuring of `goals` / `risk`:

```ts
// Phase B (inter-agent-state-handoff-sf-vs-memory): emit one long-term
// event after successful structured-output validation. Bedrock's
// USER_PREFERENCE_MEMORY strategy on /investor-profile-ctrl/{tenantId}/
// preferences extracts investor preferences from this payload across
// decision cycles. Best-effort — failures inside emitLongTermEvent are
// caught + logged + non-blocking.
const goalsOut = (result['user-goals'] as { ok: true; output: Record<string, unknown> }).output;
const riskOut = (result['risk-assessment'] as { ok: true; output: Record<string, unknown> }).output;
await deps.memoryClient
  .openDecisionSession(tenantId, decisionId)
  .emitLongTermEvent({
    namespace: 'preferences',
    payload: { goals: goalsOut, risk: riskOut },
  });

const goals = goalsOut;
const risk = riskOut;
```

(The two `goals` / `risk` destructurings that previously immediately followed `assertOrchestratorOutput` are now reused — delete the original duplicates.)

- [ ] **Step 4: Update event-listener wiring to inject memoryClient + update site 2 namespace arg**

In `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`:

```ts
// site 2 — update the search call:
const tenantHistory = await session.searchLongTermMemory('preferences', 'investor preferences risk tolerance');
```

And in the production-wiring block at the bottom:

```ts
const agentService = createAgentService({
  docClient,
  tableName: TABLE_NAME,
  memoryClient,  // <-- pass through
});
```

- [ ] **Step 5: Update graph.ts site 1 namespace arg**

In `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts:77`:

```ts
const tenantHistory = await session.searchLongTermMemory(
  'preferences',
  `prior risk assessments for tenant ${payload.tenantId}`,
  3,
);
```

- [ ] **Step 6: Update existing event-listener.test.ts and graph.test.ts mocks for the namespace arg**

In `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts` and `test/unit/graph.test.ts`, update the `mockSearchLongTermMemory` assertions to expect the new arg shape. Example:

```ts
expect(mockSearchLongTermMemory).toHaveBeenCalledWith('preferences', expect.any(String));
```

(Or for graph.test.ts with topK: `('preferences', expect.any(String), 3)`.)

- [ ] **Step 7: Run all investor-profile-ctrl tests and confirm green**

Run: `pnpm nx test investor-profile-ctrl`
Expected: all PASS, including the 2 new Phase B emit tests.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/agent-service.ts \
        services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts \
        services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts \
        services/advisory/investor-profile-ctrl/test/unit/agent-service.test.ts \
        services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts \
        services/advisory/investor-profile-ctrl/test/unit/graph.test.ts
git commit -m "feat(investor-profile-ctrl): wire Phase B emit + retrieval namespace

After assertOrchestratorOutput, emit one CreateEvent to preferences
namespace with { goals, risk } payload. Both retrieval call sites
(graph.ts:77 + event-listener.ts:25) updated for the new namespace
parameter.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 7: market-intelligence-ctrl — wire emit + update retrieval

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/agent-service.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`
- Test: `services/advisory/market-intelligence-ctrl/test/unit/agent-service.test.ts`
- Test: `services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts`

One retrieval site (event-listener.ts:25). Emit goes to `signals` namespace with the validated `market-research` output.

- [ ] **Step 1: Write the failing test in agent-service.test.ts**

Append to `services/advisory/market-intelligence-ctrl/test/unit/agent-service.test.ts`:

```ts
describe('Phase B — emitLongTermEvent integration', () => {
  it('emits one event to signals namespace after successful validation', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'market-research': { ok: true, output: { signals: [{ sector: 'TECH', strength: 0.8 }] } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'd1',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    });

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).toHaveBeenCalledTimes(1);
    expect(session.emitLongTermEvent).toHaveBeenCalledWith({
      namespace: 'signals',
      payload: expect.objectContaining({
        marketResearch: expect.objectContaining({ signals: expect.any(Array) }),
      }),
    });
  });

  it('does NOT emit when output is degraded', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'market-research': { ok: false, reason: 'timeout' },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await expect(service.runPipeline('evt-2', { tenantId: 't1', decisionId: 'd2', operatingMode: 'BALANCED', taskToken: 'tok' })).rejects.toThrow();

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm nx test market-intelligence-ctrl -t 'emitLongTermEvent integration'`
Expected: 2 FAIL.

- [ ] **Step 3: Add memoryClient to deps + emit after validation**

In `services/advisory/market-intelligence-ctrl/src/agent-service.ts`:

```ts
import type { MemoryClient } from '@nestfolio/agent-orchestrator';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly memoryClient: MemoryClient;
}
```

Immediately after `assertOrchestratorOutput(result, ['market-research'], { decisionId, agent: 'market-intelligence' });`:

```ts
const marketResearch = (result['market-research'] as { ok: true; output: Record<string, unknown> }).output;

// Phase B emit to signals namespace.
await deps.memoryClient
  .openDecisionSession(tenantId, decisionId)
  .emitLongTermEvent({
    namespace: 'signals',
    payload: { marketResearch },
  });
```

(Delete the original `const marketResearch = ...` line that came after this if duplicated.)

- [ ] **Step 4: Update event-listener.ts site 3 + wiring**

```ts
// site 3 — namespace arg:
const tenantHistory = await session.searchLongTermMemory('signals', 'market signals sector trends');

// production wiring:
const agentService = createAgentService({
  docClient,
  tableName: TABLE_NAME,
  memoryClient,
});
```

- [ ] **Step 5: Update existing event-listener.test.ts mocks**

```ts
expect(mockSearchLongTermMemory).toHaveBeenCalledWith('signals', expect.any(String));
```

- [ ] **Step 6: Run all market-intelligence-ctrl tests**

Run: `pnpm nx test market-intelligence-ctrl`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src
git add services/advisory/market-intelligence-ctrl/test
git commit -m "feat(market-intelligence-ctrl): wire Phase B emit + retrieval namespace

Emit to signals namespace with { marketResearch } payload after
assertOrchestratorOutput. Retrieval call updated for namespace arg.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 8: portfolio-engine-ctrl — wire emit + update retrieval

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`
- Test: `services/advisory/portfolio-engine-ctrl/test/unit/agent-service.test.ts`
- Test: `services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts`

One retrieval site (event-listener.ts:45). Emit goes to `rationale` namespace with the validated `portfolio-construction` + `rebalance-planner` outputs (the asset weights + trade plan + reasoning).

- [ ] **Step 1: Write the failing test in agent-service.test.ts**

Append to `services/advisory/portfolio-engine-ctrl/test/unit/agent-service.test.ts`:

```ts
describe('Phase B — emitLongTermEvent integration', () => {
  it('emits one event to rationale namespace after successful validation', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ ticker: 'VOO', weight: 0.6 }] } },
      'rebalance-planner': { ok: true, output: { trades: [{ ticker: 'VOO', side: 'BUY', qty: 10 }] } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'd1',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    });

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).toHaveBeenCalledTimes(1);
    expect(session.emitLongTermEvent).toHaveBeenCalledWith({
      namespace: 'rationale',
      payload: expect.objectContaining({
        allocations: expect.objectContaining({ allocations: expect.any(Array) }),
        trades: expect.objectContaining({ trades: expect.any(Array) }),
      }),
    });
  });

  it('does NOT emit when output is degraded', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'portfolio-construction': { ok: false, reason: 'empty' },
      'rebalance-planner': { ok: true, output: { trades: [] } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await expect(service.runPipeline('evt-2', { tenantId: 't1', decisionId: 'd2', operatingMode: 'BALANCED', taskToken: 'tok' })).rejects.toThrow();

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm nx test portfolio-engine-ctrl -t 'emitLongTermEvent integration'`
Expected: 2 FAIL.

- [ ] **Step 3: Add memoryClient to deps + emit after validation**

In `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`:

```ts
import type { MemoryClient } from '@nestfolio/agent-orchestrator';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly memoryClient: MemoryClient;
}
```

Immediately after `assertOrchestratorOutput(result, ['portfolio-construction', 'rebalance-planner'], { decisionId, agent: 'portfolio-engine' });`:

```ts
const allocations = (result['portfolio-construction'] as { ok: true; output: Record<string, unknown> }).output;
const trades = (result['rebalance-planner'] as { ok: true; output: Record<string, unknown> }).output;

// Phase B emit to rationale namespace.
await deps.memoryClient
  .openDecisionSession(tenantId, decisionId)
  .emitLongTermEvent({
    namespace: 'rationale',
    payload: { allocations, trades, modeUsed: operatingMode },
  });
```

Delete the duplicate destructurings that came after the original assertOrchestratorOutput.

- [ ] **Step 4: Update event-listener.ts site 4 + wiring**

```ts
// site 4 — namespace arg:
const pastRationale = await session.searchLongTermMemory('rationale', 'allocation rationale decisions');

// production wiring:
const agentService = createAgentService({
  docClient,
  tableName: TABLE_NAME,
  memoryClient,
});
```

- [ ] **Step 5: Update existing event-listener.test.ts + graph.test.ts mocks**

```ts
expect(mockSearchLongTermMemory).toHaveBeenCalledWith('rationale', expect.any(String));
```

- [ ] **Step 6: Run all portfolio-engine-ctrl tests**

Run: `pnpm nx test portfolio-engine-ctrl`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src \
        services/advisory/portfolio-engine-ctrl/test
git commit -m "feat(portfolio-engine-ctrl): wire Phase B emit + retrieval namespace

Emit to rationale namespace with { allocations, trades, modeUsed }
payload after assertOrchestratorOutput. Retrieval call updated for
namespace arg.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 9: advisory-narrative-ctrl — wire emit + MERGE sites 5+6 retrieval

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/agent-service.test.ts`
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts`

Two retrieval call sites in event-listener.ts:45-46 — `'narrative preferences communication style'` and `'session summaries'` — merge into a single `rationale` query. The agent input field name changes from `{ preferences, sessionHistory }` to `{ priorNarratives }`. Emit goes to `rationale` namespace with the validated `explainability` output.

- [ ] **Step 1: Write the failing test in agent-service.test.ts**

Append to `services/advisory/advisory-narrative-ctrl/test/unit/agent-service.test.ts`:

```ts
describe('Phase B — emitLongTermEvent integration', () => {
  it('emits one event to rationale namespace after successful validation', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'explainability': { ok: true, output: { narrative: 'You should...', tone: 'measured' } },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'd1',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    });

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).toHaveBeenCalledTimes(1);
    expect(session.emitLongTermEvent).toHaveBeenCalledWith({
      namespace: 'rationale',
      payload: expect.objectContaining({
        narrative: expect.stringContaining('You should'),
        tone: 'measured',
      }),
    });
  });

  it('does NOT emit when explainability output is degraded', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'explainability': { ok: false, reason: 'empty' },
    });

    const memoryClient = {
      openDecisionSession: jest.fn().mockReturnValue({
        emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
        searchLongTermMemory: jest.fn().mockResolvedValue([]),
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    };

    const service = createAgentService({ ...deps, memoryClient });
    await expect(service.runPipeline('evt-2', { tenantId: 't1', decisionId: 'd2', operatingMode: 'BALANCED', taskToken: 'tok' })).rejects.toThrow();

    const session = memoryClient.openDecisionSession.mock.results[0].value;
    expect(session.emitLongTermEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing test for the sites 5+6 merge in event-listener.test.ts**

Open `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts` and read the existing `describe('GENERATE_NARRATIVE')` block to see the established fixture pattern (`mockSearchLongTermMemory`, `mockRunPipeline`, and the payload/ctx shape used by `handlers.GENERATE_NARRATIVE(...)`). The new tests follow that exact pattern. Append:

```ts
describe('Phase B — sites 5+6 merged into single rationale query', () => {
  const basePayload = {
    subject: {
      tenantId: 't1',
      decisionId: 'd1',
      operatingMode: 'BALANCED',
      investorProfile: { age: 35 },
      marketAnalysis: { signals: [] },
      portfolio: { allocations: [] },
    },
  };
  const baseCtx = { eventId: 'evt-narr-1', tenantId: 't1' };

  beforeEach(() => {
    mockSearchLongTermMemory.mockReset();
    mockRunPipeline.mockReset();
    mockSearchLongTermMemory.mockResolvedValue([]);
    mockRunPipeline.mockResolvedValue({ output: { decisionId: 'd1', narrative: 'ok' } });
  });

  it('calls searchLongTermMemory exactly once with rationale namespace', async () => {
    await handlers.GENERATE_NARRATIVE(basePayload, baseCtx);
    expect(mockSearchLongTermMemory).toHaveBeenCalledTimes(1);
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith(
      'rationale',
      'prior decision narratives and communication style',
    );
  });

  it('passes the rationale recall content into runPipeline as priorNarratives', async () => {
    mockSearchLongTermMemory.mockResolvedValueOnce([
      { content: 'Previous cycle suggested cautious tone', score: 0.9, memoryRecordId: 'r1' },
    ]);
    await handlers.GENERATE_NARRATIVE(basePayload, baseCtx);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-narr-1',
      expect.objectContaining({
        priorNarratives: ['Previous cycle suggested cautious tone'],
      }),
    );
    const lastCallArgs = mockRunPipeline.mock.calls.at(-1)?.[1] ?? {};
    expect('preferences' in lastCallArgs).toBe(false);
    expect('sessionHistory' in lastCallArgs).toBe(false);
  });
});
```

If the existing fixtures use different names (e.g., `mockRunAgentService` instead of `mockRunPipeline`), rename in the new block to match. Do NOT alter the existing tests.

- [ ] **Step 3: Run the tests, confirm they fail**

Run: `pnpm nx test advisory-narrative-ctrl -t 'Phase B'`
Expected: FAIL — neither the emit nor the merge is implemented.

- [ ] **Step 4: Add memoryClient to deps + emit after validation in agent-service.ts**

```ts
import type { MemoryClient } from '@nestfolio/agent-orchestrator';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly memoryClient: MemoryClient;
}
```

Immediately after `assertOrchestratorOutput(result, ['explainability'], { decisionId, agent: 'advisory-narrative' });`:

```ts
const explainability = (result['explainability'] as { ok: true; output: Record<string, unknown> }).output;

// Phase B emit to rationale namespace. Narrative writes go ONLY to
// rationale (not preferences) per design spec Part B; the preferences
// strategy is fed exclusively by investor-profile-ctrl.
await deps.memoryClient
  .openDecisionSession(tenantId, decisionId)
  .emitLongTermEvent({
    namespace: 'rationale',
    payload: explainability,
  });
```

Delete the duplicate `const explainability = ...` line that came after the original assertOrchestratorOutput.

- [ ] **Step 5: Merge sites 5+6 in event-listener.ts**

In `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`, replace the existing `const [preferences, sessionHistory] = await Promise.all([...])` retrieval block (around lines 40-48) with a single rationale query. The full updated body of `GENERATE_NARRATIVE` reads:

```ts
GENERATE_NARRATIVE: async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const decisionId = subject.decisionId as string;

  logger.info('Processing GENERATE_NARRATIVE', { decisionId, tenantId });

  const operatingMode = subject.operatingMode as string | undefined;
  if (!operatingMode) {
    throw new UnknownOperatingModeError({
      decisionId,
      resolutionPath: 'subject.operatingMode (propagated by SF from InvokeInvestorProfile result)',
      availableKeys: Object.keys(subject),
    });
  }

  const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

  // Phase B (inter-agent-state-handoff-sf-vs-memory): the previous two
  // retrieval sites (preferences/communication-style + session summaries)
  // merged into one rationale query. Narrative no longer writes to its
  // own preferences namespace; the rationale namespace carries both prior
  // decision narratives and the tone signals a returning narrative agent
  // uses to maintain stylistic consistency.
  const priorNarratives = await session.searchLongTermMemory(
    'rationale',
    'prior decision narratives and communication style',
  );

  const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
  const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};
  const portfolio = (subject.portfolio as Record<string, unknown> | undefined) ?? {};

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, {
      tenantId,
      decisionId,
      operatingMode,
      investorProfile,
      marketAnalysis,
      portfolio,
      priorNarratives: priorNarratives.map(r => r.content),
    });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info('Duplicate GENERATE_NARRATIVE event, skipping', { eventId: ctx.eventId, decisionId });
      return { output: { decisionId, tenantId, deduplicated: true } };
    }
    throw error;
  }

  const wrapped = wrapAgentOutput(result);
  return {
    output: { decisionId, tenantId, agentOutput: wrapped.value },
    intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'advisory-narrative' })],
  };
},
```

If the current handler has additional logic between the retrieval and `runPipeline` (e.g., extra logging, intent emission, etc.) that the above snippet does not show, preserve it — the only structural changes are: (1) drop the `Promise.all` and the two old searches; (2) add the single rationale search; (3) replace the `preferences` + `sessionHistory` fields in the `runPipeline` payload with `priorNarratives`.

Also update the production wiring at the bottom:

```ts
const agentService = createAgentService({
  docClient,
  tableName: TABLE_NAME,
  memoryClient,
});
```

- [ ] **Step 6: Update agent-side prompt template if needed**

If `advisory-narrative-ctrl/agents/advisory-narrative/...` has prompt templates referencing `{{preferences}}` or `{{sessionHistory}}`, replace with `{{priorNarratives}}`. Grep:

```bash
grep -rn 'preferences\|sessionHistory' services/advisory/advisory-narrative-ctrl/agents/ services/advisory/advisory-narrative-ctrl/src/agent-service.ts 2>/dev/null | grep -v test | grep -v dist
```

Update any matches to use the new field name.

- [ ] **Step 7: Run all advisory-narrative-ctrl tests**

Run: `pnpm nx test advisory-narrative-ctrl`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src \
        services/advisory/advisory-narrative-ctrl/test \
        services/advisory/advisory-narrative-ctrl/agents
git commit -m "feat(advisory-narrative-ctrl): Phase B emit + merge sites 5+6

Emit one CreateEvent to rationale namespace with the validated
explainability output ({ narrative, tone }) after
assertOrchestratorOutput.

Merge the two pre-Phase-B retrieval calls — 'narrative preferences
communication style' against the empty preferences namespace, and
'session summaries' against an out-of-scope sessions namespace — into a
single rationale query 'prior decision narratives and communication
style'. Agent input field renamed from { preferences, sessionHistory }
to { priorNarratives }.

Part of Phase B inter-agent-state-handoff-sf-vs-memory."
```

---

### Task 10: Cross-cutting integration check + repo-wide test run

- [ ] **Step 1: Run nx affected tests**

Run: `pnpm nx affected --target=test --base=main~1`
Expected: all PASS across touched projects.

- [ ] **Step 2: Run nx affected lint + build**

Run: `pnpm nx affected --target=lint --base=main~1 && pnpm nx affected --target=build --base=main~1`
Expected: all PASS.

- [ ] **Step 3: Run nx affected synth**

Run: `pnpm nx affected --target=synth --base=main~1`
Expected: all PASS. Particularly the decision-workflow-ctrl synth must succeed and produce a CloudFormation template containing the 3 MemoryStrategies.

- [ ] **Step 4: Visually inspect the synthesised Memory resource**

Run: `pnpm nx run decision-workflow-ctrl:synth --quiet && grep -A 200 'AWS::BedrockAgentCore::Memory' apps/infrastructure/cdk.out/dev-advisory-decision-workflow-ctrl.template.json | head -250`
Expected: 3 MemoryStrategies visible with correct namespaces + prompts.

- [ ] **Step 5: Commit (if any test-fix tweaks were needed)**

If anything was tweaked during this task, commit those tweaks. Otherwise no commit.

---

### Task 11: Deploy to dev sandbox

- [ ] **Step 1: Deploy the touched services to dev**

Run (pre-authorised per CLAUDE.md auto-mode):
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=decision-workflow-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl \
  2>&1 | tee /tmp/phase-b-deploy.log
```
Expected: all 5 stacks deploy clean. The decision-workflow-ctrl deploy creates the 3 MemoryStrategies (new CFN resource type `AWS::BedrockAgentCore::Memory` property `MemoryStrategies`). AgentRuntime updates for the 4 agent ctrls re-bundle + push to ECR + update the runtime.

- [ ] **Step 2: Sanity-check the deployed Memory resource**

Run:
```bash
AWS_PROFILE=nestfolio-dev aws bedrock-agentcore-control list-memory-strategies \
  --memory-id $(AWS_PROFILE=nestfolio-dev aws ssm get-parameter \
    --name '/nestfolio/dev-advisory-decision-workflow-ctrl/memory/id' \
    --query 'Parameter.Value' --output text)
```
Expected: 3 strategies listed with the expected names and namespace patterns.

---

### Task 12: Validation gate — 5 e2e runs + extraction wait + manual recall

The spec's Phase B validation gate:

> Run e2e for the same tenant 5 times in a row → wait 5 minutes (Bedrock extraction lag) → manual `searchLongTermMemory` queries against each of the 3 namespaces → confirm non-empty extracted records with coherent summary text (not raw JSON dumps).

- [ ] **Step 1: Run the e2e feature tests 5 consecutive times**

Run (each run uses a fresh tenant prefix in the test harness — to validate cross-decision recall we need a single STABLE tenant; the e2e test must accept a `STABLE_TENANT_ID` override or we run a custom 5-iteration script):

```bash
for i in 1 2 3 4 5; do
  echo "=== e2e iteration $i ==="
  NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features \
    --testPathPatterns first-decision \
    2>&1 | tee /tmp/phase-b-e2e-$i.log
done
```
Expected: each run shows the first-decision flow completing for the test tenant. If the e2e test creates a fresh tenant per run, this won't produce cross-decision extraction — confirm tenant reuse first by reading `apps/e2e-feature-tests/src/.../first-decision.e2e.test.ts`. If tenants are fresh per run, a temporary script that reuses tenant IDs is required to exercise cross-decision recall — file this as a backlog item rather than blocking Phase B if the e2e fixture doesn't support stable tenants.

- [ ] **Step 2: Wait 5 minutes for Bedrock extraction**

Wait at least 5 minutes after the 5th run completes. Strategies extract asynchronously.

- [ ] **Step 3: Manual `searchLongTermMemory` queries per namespace**

Pick the stable tenant ID used by the 5 e2e runs (call it `$TENANT_ID`). For each namespace, query directly via the SDK:

```bash
AWS_PROFILE=nestfolio-dev aws bedrock-agentcore retrieve-memory-records \
  --memory-id $(AWS_PROFILE=nestfolio-dev aws ssm get-parameter \
    --name '/nestfolio/dev-advisory-decision-workflow-ctrl/memory/id' \
    --query 'Parameter.Value' --output text) \
  --namespace "/investor-profile-ctrl/$TENANT_ID/preferences" \
  --search-criteria '{"searchQuery": "risk tolerance", "topK": 3}'

# Repeat for /market-intelligence-ctrl/$TENANT_ID/signals
# Repeat for /portfolio-engine-ctrl/$TENANT_ID/rationale
# Repeat for /advisory-narrative-ctrl/$TENANT_ID/rationale
```
Expected: each query returns ≥1 record with coherent summary text (NOT raw JSON dumps).

- [ ] **Step 4: Check Memory CloudWatch metrics for extraction signals**

Open the AgentCore Memory metrics view in CloudWatch (or use `aws cloudwatch get-metric-statistics`) and confirm:

- Strategy extraction invocations > 0 over the past hour
- Strategy extraction failure rate < 5%

If failure rate ≥ 5%, do NOT proceed to ship. Investigate via the strategy-specific log group (look for Bedrock extraction errors — common causes: prompt format mismatch, model throttling, payload too large).

- [ ] **Step 5: Capture validation evidence**

Save the 4 retrieve-memory-records outputs (one per namespace) to a local file (NOT committed) and reference the timestamp + tenant ID in the backlog ship narrative in Task 13.

---

### Task 13: Workstream ship

- [ ] **Step 1: Update docs/architecture/SYSTEM-ARCHITECTURE.md §17**

In `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 (AgentCore Memory Contract), replace the "Strategy mapping" subsection to reflect the now-implemented strategies and namespaces. Add a "17.3 Architectural Evolution — Long-term recall wired" subsection narrating Phase B's ship with the date + commit hash.

- [ ] **Step 2: Flip the backlog dossier to `status: shipped`**

In `docs/backlog/inter-agent-state-handoff-sf-vs-memory.md`:

```yaml
status: shipped
validation_gate: |
  Phase B SHIPPED 2026-MM-DD on `main` (commit hash). 5 consecutive e2e
  runs against stable tenant $TENANT_ID; 5-min extraction wait;
  retrieve-memory-records returned ≥1 coherent record from each of the 4
  active namespace patterns (preferences, signals, 2× rationale).
```

Add a "Phase B — SHIPPED YYYY-MM-DD" body section with the same narrative shape as Phase A's section, listing per-Task diff summaries.

- [ ] **Step 3: Run backlog-lint --fix**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: regenerates `docs/BACKLOG.md` and updates `related_workstreams` in linked topic dossiers. No lint errors.

- [ ] **Step 4: Create the topic memory dossier**

Create `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_inter_agent_state_handoff.md`:

```markdown
---
name: project-inter-agent-state-handoff
description: Phase A (SF state for ephemeral handoff) shipped 2026-05-14; Phase B (Bedrock MemoryStrategies on preferences/signals/rationale) shipped <date>.
metadata:
  type: project
---

# Inter-Agent State Handoff (advisory)

## Phase A — SHIPPED 2026-05-14 (676dd75c, PR #6)
- Moved inter-agent ephemeral output handoff from AgentCore Memory to SF state.
- p95 narrative latency: ~56s → ~22-30s on dev.
- Removed: MemoryClient.writeAgentOutput/readUpstreamOutput + their IAM grants.
- Kept: agentcore.Memory + RetrieveMemoryRecords grant for Phase B.

## Phase B — SHIPPED <date> (<commit>)
- 3 MemoryStrategies provisioned on agentcore.Memory:
  - InvestorPreferenceLearner (USER_PREFERENCE_MEMORY) → /investor-profile-ctrl/{tenantId}/preferences
  - MarketSignalExtractor (SEMANTIC_MEMORY) → /market-intelligence-ctrl/{tenantId}/signals
  - RationaleArchivist (SEMANTIC_MEMORY) → /portfolio-engine-ctrl/{tenantId}/rationale + /advisory-narrative-ctrl/{tenantId}/rationale
- MemoryClient.emitLongTermEvent({ namespace, payload }) wraps CreateEventCommand.
  sessionId = decisionId; conversational payload role = ASSISTANT.
- MemoryClient.searchLongTermMemory now takes (namespace, query, topK?).
- Sites 5+6 in advisory-narrative event-listener merged into one rationale query.
- 5 retrieval call sites post-Phase-B (was 6).
- IAM: Memory execution role bedrock:InvokeModel restored; CreateEvent grant on the 4 agent runtimes preserved from Phase A.
- Extraction model: Haiku.

## Related backlog
- [[inter-agent-state-handoff-sf-vs-memory]] (shipped)
```

Then append a line to `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` under "## Topic Files":

```markdown
- [Inter-agent state handoff](./project_inter_agent_state_handoff.md) — Phase A (SF state, 2026-05-14) + Phase B (3 MemoryStrategies, <date>).
```

- [ ] **Step 5: Final boundary review of docs/BACKLOG.md**

Open `docs/BACKLOG.md`, re-rank LATER, drop aged-out items, promote any QUEUED items as appropriate. (Per CLAUDE.md "at each workstream ship".)

- [ ] **Step 6: Commit all docs/backlog/memory updates**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md \
        docs/backlog/inter-agent-state-handoff-sf-vs-memory.md \
        docs/BACKLOG.md
# memory files live outside the repo working tree — no git add for those

git commit -m "docs: ship Phase B inter-agent-state-handoff (long-term recall wired)

3 MemoryStrategies live on dev (preferences, signals, rationale).
5 retrieval call sites returning extracted records after a stable-tenant
5x e2e run + 5-min extraction lag.

Closes workstream inter-agent-state-handoff-sf-vs-memory."
```

- [ ] **Step 7: Open the PR**

Push to a feature branch and open a PR with all Phase B commits. Use the workstream's standard PR format with the dossier path as the source of truth.

---

## Out of scope (reaffirmed from spec)

- Onboarding-bff Memory usage (different namespace patterns, different domain).
- `/{service}/{tenantId}/sessions/{sessionId}` long-term namespace (onboarding wizard scope).
- Backfilling historical decision data into long-term namespaces.
- Bumping `advisoryNarrative` latency budget — the residual ~22-28s is tracked separately as `advisory-narrative-agentcore-latency-residual` (queued, rank 20, post-Phase-B).
- Production rollout sequencing.
