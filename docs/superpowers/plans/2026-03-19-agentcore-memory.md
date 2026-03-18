# AgentCore Memory Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Amazon Bedrock AgentCore Memory into the advisory agent pipeline — replacing `upstreamOutputs` payload threading with shared Memory sessions and adding cross-decision learning via long-term memory strategies.

**Architecture:** One Memory resource in decision-workflow-ctrl stack, shared via SSM. A thin `createMemoryClient` helper in agent-core standardizes namespace conventions and provides graceful degradation. Each agent service writes outputs to Memory instead of SF payloads. The AssembleDecisionPacket Pass state becomes a Lambda that reads from Memory.

**Tech Stack:** TypeScript, `@aws-cdk/aws-bedrock-agentcore-alpha` (CDK), `@aws-sdk/client-bedrock-agent-runtime` (runtime — verify exact command names at implementation time, SDK is alpha), Jest, CDK assertions

**Important SDK note:** The `@aws-sdk/client-bedrock-agent-runtime` may not yet have `CreateEventCommand` and `RetrieveMemoryRecordsCommand`. At implementation time, check the installed SDK version for exact command names. The plan uses these as placeholders — adapt to actual API surface. If commands don't exist yet, use raw `client.send()` with the appropriate API action.

**Spec:** `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`

**Chunks:** 4 total (agent-core runtime helper → CDK wiring → agent service integration → decision-workflow-ctrl simplification)

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `libs/agent-core/src/memory/memory-client.ts` | `createMemoryClient` factory + `DecisionSession` + `MemoryClient` interfaces and implementation |
| `libs/agent-core/src/memory/no-op-client.ts` | No-op implementation for graceful degradation |
| `libs/agent-core/src/memory/index.ts` | Barrel export for memory module |
| `libs/agent-core/test/memory-client.test.ts` | Tests for memory client: write, read upstream, search, no-op fallback |
| `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` | New Lambda handler: reads 4 outputs from Memory, writes assembled DecisionPacket to DDB |
| `services/advisory/decision-workflow-ctrl/test/assemble-packet.test.ts` | Tests for assemble-packet handler |

### Modified files

| File | Change |
|------|--------|
| `libs/agent-core/src/index.ts` | Add memory module re-exports |
| `services/advisory/decision-workflow-ctrl/src/service.stack.ts` | Add `agentcore.Memory` construct, SSM export, AssemblePacket Lambda, `MEMORY_ID` env var + IAM grants |
| `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | Simplify `createAgentInvocationState` (remove `upstreamOutputs` threading), simplify `MergeParallelOutputs`, replace AssembleDecisionPacket Pass state with Lambda Task state |
| `services/advisory/decision-workflow-ctrl/src/service-domain/models.ts` | Remove 4 output fields from `DecisionPacket`, simplify `AgentTriggerPayload` (remove `upstreamOutputs`), simplify `AgentCompletionPayload` (remove `outputs`) |
| `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts` | Remove `storeAgentOutput` method |
| `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` | Simplify completion event handling — `SendTaskSuccess` with `{ decisionId }` only |
| `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts` | Assert Memory construct + AssemblePacket Lambda |
| `services/advisory/decision-workflow-ctrl/test/decision-packet.repository.test.ts` | Remove `storeAgentOutput` tests |
| `services/advisory/decision-workflow-ctrl/test/event-listener.test.ts` | Update completion event tests |
| `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (build target) | Add `assemble-packet.ts` as additional entry point |
| `services/advisory/investor-profile-ctrl/src/service.stack.ts` | Add `MEMORY_ID` env var + IAM grants |
| `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` | Add Memory write after agent pipeline, remove `outputs` from completion event |
| `services/advisory/investor-profile-ctrl/test/event-listener.test.ts` | Update handler tests for Memory integration |
| `services/advisory/market-intelligence-ctrl/src/service.stack.ts` | Add `MEMORY_ID` env var + IAM grants |
| `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` | Add Memory write, search long-term memory, remove `outputs` from completion event |
| `services/advisory/market-intelligence-ctrl/test/event-listener.test.ts` | Update handler tests |
| `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` | Add `MEMORY_ID` env var + IAM grants |
| `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | Replace `upstreamOutputs` parsing with Memory reads, add Memory write |
| `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts` | Update handler tests |
| `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` | Add `MEMORY_ID` env var + IAM grants |
| `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` | Replace `upstreamOutputs` parsing with Memory reads, add Memory write |
| `services/advisory/advisory-narrative-ctrl/test/event-listener.test.ts` | Update handler tests |

---

## Chunk 1 — agent-core Memory Runtime Helper

### Task 1.1 — Memory client types and no-op implementation

- [ ] Create `libs/agent-core/src/memory/memory-client.ts` with types + implementation:

```typescript
import { BedrockAgentRuntimeClient, CreateEventCommand, RetrieveMemoryRecordsCommand } from '@aws-sdk/client-bedrock-agent-runtime';

export interface MemoryClientConfig {
  memoryId: string;
  region: string;
  serviceName: string;
}

export interface MemoryRecord {
  content: string;
  relevanceScore: number;
  memoryRecordId: string;
  tags?: Record<string, string>;
}

export interface DecisionSession {
  writeAgentOutput(output: Record<string, unknown>): Promise<void>;
  readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]>;
  searchLongTermMemory(query: string, topK?: number): Promise<MemoryRecord[]>;
}

export interface MemoryClient {
  openDecisionSession(tenantId: string, decisionId: string): DecisionSession;
  searchTenantMemory(tenantId: string, query: string, topK?: number): Promise<MemoryRecord[]>;
}

export function createMemoryClient(config: MemoryClientConfig): MemoryClient {
  const client = new BedrockAgentRuntimeClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, decisionId: string): DecisionSession {
      const writeNamespace = `/${config.serviceName}/${tenantId}/decisions/${decisionId}`;

      return {
        async writeAgentOutput(output: Record<string, unknown>): Promise<void> {
          await client.send(new CreateEventCommand({
            memoryId: config.memoryId,
            actorId: tenantId,
            sessionId: decisionId,
            messages: [
              { role: 'ASSISTANT', content: JSON.stringify(output) },
            ],
          }));
        },

        async readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]> {
          const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
          const resp = await client.send(new RetrieveMemoryRecordsCommand({
            memoryId: config.memoryId,
            namespace,
            searchCriteria: { searchQuery: 'agent output', topK: 5 },
          }));
          return (resp.memoryRecords ?? []).map(mapRecord);
        },

        async searchLongTermMemory(query: string, topK = 5): Promise<MemoryRecord[]> {
          const namespace = `/${config.serviceName}/${tenantId}`;
          const resp = await client.send(new RetrieveMemoryRecordsCommand({
            memoryId: config.memoryId,
            namespace,
            searchCriteria: { searchQuery: query, topK },
          }));
          return (resp.memoryRecords ?? []).map(mapRecord);
        },
      };
    },

    async searchTenantMemory(tenantId: string, query: string, topK = 5): Promise<MemoryRecord[]> {
      const namespace = `/${config.serviceName}/${tenantId}`;
      const resp = await client.send(new RetrieveMemoryRecordsCommand({
        memoryId: config.memoryId,
        namespace,
        searchCriteria: { searchQuery: query, topK },
      }));
      return (resp.memoryRecords ?? []).map(mapRecord);
    },
  };
}

function mapRecord(r: any): MemoryRecord {
  return {
    content: r.memoryRecordSummary?.content ?? '',
    relevanceScore: r.memoryRecordSummary?.relevanceScore ?? 0,
    memoryRecordId: r.memoryRecordSummary?.memoryRecordId ?? '',
    tags: r.memoryRecordSummary?.tags,
  };
}
```

- [ ] Create `libs/agent-core/src/memory/no-op-client.ts`:

```typescript
import type { MemoryClient, DecisionSession, MemoryRecord } from './memory-client';

const noOpSession: DecisionSession = {
  async writeAgentOutput(): Promise<void> { /* no-op */ },
  async readUpstreamOutput(): Promise<MemoryRecord[]> { return []; },
  async searchLongTermMemory(): Promise<MemoryRecord[]> { return []; },
};

export function createNoOpMemoryClient(): MemoryClient {
  return {
    openDecisionSession(): DecisionSession { return noOpSession; },
    async searchTenantMemory(): Promise<MemoryRecord[]> { return []; },
  };
}
```

- [ ] Create `libs/agent-core/src/memory/index.ts`:

```typescript
export { createMemoryClient, MemoryClient, MemoryClientConfig, DecisionSession, MemoryRecord } from './memory-client';
export { createNoOpMemoryClient } from './no-op-client';
```

- [ ] Add memory re-exports to `libs/agent-core/src/index.ts`:

```typescript
// Add at the end of the file:
export { createMemoryClient, createNoOpMemoryClient, MemoryClient, MemoryClientConfig, DecisionSession, MemoryRecord } from './memory';
```

**Commit:** `feat(agent-core): add createMemoryClient with no-op fallback`

### Task 1.2 — Memory client tests

- [ ] Create `libs/agent-core/test/memory-client.test.ts`:

```typescript
import { createMemoryClient } from '../src/memory/memory-client';
import { createNoOpMemoryClient } from '../src/memory/no-op-client';

// Mock AWS SDK
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => {
  const sendMock = jest.fn();
  return {
    BedrockAgentRuntimeClient: jest.fn(() => ({ send: sendMock })),
    CreateEventCommand: jest.fn((input) => ({ input, __type: 'CreateEvent' })),
    RetrieveMemoryRecordsCommand: jest.fn((input) => ({ input, __type: 'RetrieveMemory' })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } = jest.requireMock('@aws-sdk/client-bedrock-agent-runtime');

describe('createMemoryClient', () => {
  const config = { memoryId: 'mem-123', region: 'us-east-1', serviceName: 'investor-profile' };

  beforeEach(() => sendMock.mockReset());

  describe('openDecisionSession', () => {
    it('writeAgentOutput sends CreateEventCommand with correct namespace', async () => {
      sendMock.mockResolvedValue({});
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.writeAgentOutput({ goals: 'conservative' });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.memoryId).toBe('mem-123');
      expect(cmd.input.actorId).toBe('tenant-1');
      expect(cmd.input.sessionId).toBe('dec-42');
    });

    it('readUpstreamOutput queries correct upstream namespace', async () => {
      sendMock.mockResolvedValue({
        memoryRecords: [{
          memoryRecordSummary: { content: '{"signals":[]}', relevanceScore: 0.95, memoryRecordId: 'rec-1' },
        }],
      });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      const records = await session.readUpstreamOutput('market-intelligence');

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.namespace).toBe('/market-intelligence/tenant-1/decisions/dec-42');
      expect(records).toHaveLength(1);
      expect(records[0].relevanceScore).toBe(0.95);
    });

    it('searchLongTermMemory uses service namespace', async () => {
      sendMock.mockResolvedValue({ memoryRecords: [] });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.searchLongTermMemory('risk tolerance', 3);

      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
      expect(cmd.input.searchCriteria.topK).toBe(3);
    });
  });

  it('searchTenantMemory uses service namespace', async () => {
    sendMock.mockResolvedValue({ memoryRecords: [] });
    const client = createMemoryClient(config);

    await client.searchTenantMemory('tenant-1', 'past allocations');

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
  });
});

describe('createNoOpMemoryClient', () => {
  it('writeAgentOutput resolves without error', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('t', 'd');
    await expect(session.writeAgentOutput({})).resolves.toBeUndefined();
  });

  it('readUpstreamOutput returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('t', 'd');
    const result = await session.readUpstreamOutput('any-service');
    expect(result).toEqual([]);
  });

  it('searchTenantMemory returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const result = await client.searchTenantMemory('t', 'query');
    expect(result).toEqual([]);
  });
});
```

- [ ] Run tests:

```
pnpm nx test agent-core --testPathPattern=memory-client
```

Expected: all 6 tests pass

**Commit:** `test(agent-core): add memory client tests`

---

## Chunk 2 — CDK Wiring (decision-workflow-ctrl + 4 agent service stacks)

### Task 2.1 — Install `@aws-cdk/aws-bedrock-agentcore-alpha`

- [ ] Add the alpha CDK package to the root workspace (consumed by decision-workflow-ctrl stack):

```
pnpm add -D @aws-cdk/aws-bedrock-agentcore-alpha -w
```

- [ ] Verify it installed:

```
pnpm nx run decision-workflow-ctrl:build
```

**Commit:** `chore: add @aws-cdk/aws-bedrock-agentcore-alpha dependency`

### Task 2.2 — Add Memory construct to decision-workflow-ctrl stack

- [ ] Read the current `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

- [ ] Add Memory construct with all 5 long-term strategies + SSM export + AssemblePacket Lambda (`NodejsFunction`). Add `MEMORY_ID` env var to ingress handler. Add IAM grants. Import `agentcore` from the alpha package and `Duration` from `aws-cdk-lib`.

The Memory construct must include these 5 strategies (from spec):

```typescript
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { Duration } from 'aws-cdk-lib';

const memory = new agentcore.Memory(this, 'AgentMemory', {
  memoryName: `nestfolio-${props.prefix}-agent-memory`,
  description: 'Shared agent memory for cross-decision learning',
  expirationDuration: Duration.days(90),
  strategies: [
    agentcore.MemoryStrategy.usingUserPreference({
      name: 'InvestorPreferenceLearner',
      namespaces: ['/investor-profile/{actorId}/preferences'],
    }),
    agentcore.MemoryStrategy.usingSemantic({
      name: 'MarketSignalExtractor',
      namespaces: ['/market-intelligence/{actorId}/signals'],
    }),
    agentcore.MemoryStrategy.usingSemantic({
      name: 'AllocationRationaleExtractor',
      namespaces: ['/portfolio-engine/{actorId}/rationale'],
    }),
    agentcore.MemoryStrategy.usingUserPreference({
      name: 'NarrativePreferenceLearner',
      namespaces: ['/advisory-narrative/{actorId}/preferences'],
    }),
    agentcore.MemoryStrategy.usingSummary({
      name: 'NarrativeSessionSummarizer',
      namespaces: ['/advisory-narrative/{actorId}/sessions'],
    }),
  ],
});
```

The AssemblePacket Lambda should use `NodejsFunction` (same as other Lambdas in the stack), NOT an `additionalEntryPoints` build target:

```typescript
const assemblePacketFn = new NodejsFunction(this, 'AssemblePacket', {
  ...defaultLambdaProps(this),
  entry: join(__dirname, 'handlers', 'assemble-packet.ts'),
  environment: {
    MEMORY_ID: memory.memoryId,
    TABLE_NAME: this.state.getTable().tableName,
  },
});
// IAM grants for Memory API
assemblePacketFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock-agentcore:*'],
  resources: ['*'],
}));
```

- [ ] Read + update `services/advisory/decision-workflow-ctrl/test/service.stack.test.ts` to assert:
  - Memory resource exists (verify CFN type from alpha package — likely `AWS::BedrockAgentCore::Memory` or similar)
  - `AWS::SSM::Parameter` for memory ID exists
  - AssemblePacket Lambda function exists with `MEMORY_ID` env var
  - `MEMORY_ID` env var on ingress handler

- [ ] Run tests:

```
pnpm nx test decision-workflow-ctrl --testPathPattern=service.stack
```

**Commit:** `feat(decision-workflow-ctrl): add AgentCore Memory construct with 5 strategies and SSM export`

### Task 2.3 — Add MEMORY_ID to 4 agent service stacks

- [ ] Update each of these 4 service stacks to add `MEMORY_ID` env var + IAM grants:
  - `services/advisory/investor-profile-ctrl/src/service.stack.ts`
  - `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
  - `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
  - `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`

Pattern for each (add after existing `hubNaming` block):

```typescript
// Read Memory ID from decision-workflow-ctrl SSM
const workflowNaming = new NamingService({
  prefix: props.prefix, subsystem: 'advisory', service: 'decision-workflow-ctrl',
});
const memoryId = StringParameter.valueForStringParameter(
  this, workflowNaming.ssmParameterPath('memory/id'),
);
ingress.handler.addEnvironment('MEMORY_ID', memoryId);

// IAM grants for Memory API (broad initially — scope when actions confirmed)
ingress.handler.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock-agentcore:*'],
  resources: ['*'],
}));
```

- [ ] Run tests for all 4:

```
pnpm nx run-many -t test --projects=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl --testPathPattern=service.stack
```

**Commit:** `feat: add MEMORY_ID env var and IAM grants to 4 agent service stacks`

---

## Chunk 3 — Agent Service Integration (Memory reads/writes in handlers)

### Task 3.1 — investor-profile-ctrl: write output to Memory

- [ ] Read `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`

- [ ] Add `MemoryClient` to the handler's `deps` (following the existing `createHandler(deps)` pattern). The client should be created at module level using env vars:

```typescript
// At module level (production wiring)
const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'investor-profile' })
  : createNoOpMemoryClient();

// Pass as dep
const deps = { ..., memoryClient };
```

- [ ] Modify the `ANALYZE_INVESTOR_PROFILE` handler to:
  1. Open a decision session via `deps.memoryClient`
  2. Search long-term memory for tenant preferences
  3. Pass tenant history to the agent pipeline
  4. Write agent output to Memory after pipeline completes
  5. Publish `INVESTOR_PROFILE_COMPLETED` with `{ decisionId, taskToken }` only (remove `outputs`)

- [ ] Read + update `services/advisory/investor-profile-ctrl/test/event-listener.test.ts`:
  - Mock `createMemoryClient` (return mock session)
  - Assert `writeAgentOutput` called with pipeline result
  - Assert `searchLongTermMemory` called before pipeline
  - Assert completion event no longer carries `outputs`

- [ ] Run tests:

```
pnpm nx test investor-profile-ctrl
```

**Commit:** `feat(investor-profile-ctrl): integrate Memory for output write and long-term search`

### Task 3.2 — market-intelligence-ctrl: write output + search long-term

- [ ] Read `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`

- [ ] Modify the `ANALYZE_MARKET` handler to:
  1. Create `MemoryClient` (or no-op)
  2. Open decision session
  3. Search long-term memory: `/market-intelligence/{tenantId}/signals`
  4. Pass signal history to agent
  5. Write agent output to Memory
  6. Remove `outputs` from completion event

- [ ] Update `services/advisory/market-intelligence-ctrl/test/event-listener.test.ts`

- [ ] Run tests:

```
pnpm nx test market-intelligence-ctrl
```

**Commit:** `feat(market-intelligence-ctrl): integrate Memory for output write and long-term search`

### Task 3.3 — portfolio-engine-ctrl: read upstream + write output

- [ ] Read `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`

- [ ] Modify the `CONSTRUCT_PORTFOLIO` handler to:
  1. Create `MemoryClient` (or no-op)
  2. Open decision session
  3. Read upstream outputs from Memory (investor-profile + market-intelligence)
  4. Search long-term memory: `/portfolio-engine/{tenantId}/rationale`
  5. Pass all context to agent pipeline
  6. Write agent output to Memory
  7. Remove `outputs` from completion event, remove `upstreamOutputs` parsing from payload

- [ ] Update `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts`

- [ ] Run tests:

```
pnpm nx test portfolio-engine-ctrl
```

**Commit:** `feat(portfolio-engine-ctrl): replace upstreamOutputs with Memory reads/writes`

### Task 3.4 — advisory-narrative-ctrl: read all upstream + write output

- [ ] Read `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`

- [ ] Modify the `GENERATE_NARRATIVE` handler to:
  1. Create `MemoryClient` (or no-op)
  2. Open decision session
  3. Read all 3 upstream outputs from Memory (investor-profile, market-intelligence, portfolio-engine)
  4. Search long-term memory: preferences + sessions
  5. Pass all context to agent
  6. Write agent output to Memory
  7. Remove `outputs` from completion event, remove `upstreamOutputs` parsing from payload

- [ ] Update `services/advisory/advisory-narrative-ctrl/test/event-listener.test.ts`

- [ ] Run tests:

```
pnpm nx test advisory-narrative-ctrl
```

**Commit:** `feat(advisory-narrative-ctrl): replace upstreamOutputs with Memory reads/writes`

---

## Chunk 4 — decision-workflow-ctrl Simplification

### Task 4.1 — Simplify DecisionPacket model and repository

- [ ] Read `services/advisory/decision-workflow-ctrl/src/service-domain/models.ts`

- [ ] Remove 4 output fields from `DecisionPacket` interface:
  - `investorProfileOutput`
  - `marketAnalysisOutput`
  - `portfolioOutput`
  - `narrativeOutput`

- [ ] Remove `upstreamOutputs` from `AgentTriggerPayload` interface

- [ ] Remove `outputs` from `AgentCompletionPayload` interface

- [ ] Read `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts`

- [ ] Remove the `storeAgentOutput` method entirely (lines ~103-117)

- [ ] Update `createDecisionPacket` method — remove initialization of the 4 output fields (`investorProfileOutput: null`, `marketAnalysisOutput: null`, `portfolioOutput: null`, `narrativeOutput: null`) from the DDB item

- [ ] Read + update `services/advisory/decision-workflow-ctrl/test/decision-packet.repository.test.ts`:
  - Remove all tests for `storeAgentOutput`

- [ ] Run tests:

```
pnpm nx test decision-workflow-ctrl --testPathPattern=decision-packet.repository
```

**Commit:** `refactor(decision-workflow-ctrl): remove agent output fields and storeAgentOutput`

### Task 4.2 — Create AssembleDecisionPacket Lambda

- [ ] Create `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`:

```typescript
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-core';
import { requireEnv } from '@nestfolio/event-processor';

const UPSTREAM_SERVICES = [
  'investor-profile',
  'market-intelligence',
  'portfolio-engine',
  'advisory-narrative',
] as const;

export interface AssemblePacketDeps {
  memoryClient: MemoryClient;
}

export function createAssemblePacketHandler(deps: AssemblePacketDeps) {
  return async (event: { decisionId: string; tenantId: string }): Promise<Record<string, unknown>> => {
    const { decisionId, tenantId } = event;
    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    // Read all 4 agent outputs from Memory in parallel
    const [investorProfile, marketAnalysis, portfolio, narrative] = await Promise.all(
      UPSTREAM_SERVICES.map((svc) => session.readUpstreamOutput(svc)),
    );

    const parse = (records: typeof investorProfile) =>
      records[0]?.content ? JSON.parse(records[0].content) : null;

    return {
      decisionId,
      tenantId,
      investorProfileOutput: parse(investorProfile),
      marketAnalysisOutput: parse(marketAnalysis),
      portfolioOutput: parse(portfolio),
      narrativeOutput: parse(narrative),
    };
  };
}

// Production wiring
const memoryId = requireEnv('MEMORY_ID');
const region = process.env.AWS_REGION ?? 'us-east-1';
const memoryClient = createMemoryClient({ memoryId, region, serviceName: 'decision-workflow' });
export const handler = createAssemblePacketHandler({ memoryClient });
```

- [ ] Create `services/advisory/decision-workflow-ctrl/test/assemble-packet.test.ts`:

```typescript
import { createAssemblePacketHandler } from '../src/handlers/assemble-packet';

describe('assemble-packet handler', () => {
  const mockReadUpstream = jest.fn();
  const mockMemoryClient = {
    openDecisionSession: jest.fn(() => ({
      writeAgentOutput: jest.fn(),
      readUpstreamOutput: mockReadUpstream,
      searchLongTermMemory: jest.fn(),
    })),
    searchTenantMemory: jest.fn(),
  };

  const handler = createAssemblePacketHandler({ memoryClient: mockMemoryClient as any });

  beforeEach(() => mockReadUpstream.mockReset());

  it('reads all 4 upstream outputs from Memory', async () => {
    mockReadUpstream.mockResolvedValue([{ content: '{"test":true}', relevanceScore: 1, memoryRecordId: 'r1' }]);

    const result = await handler({ decisionId: 'dec-1', tenantId: 'tenant-1' });

    expect(mockReadUpstream).toHaveBeenCalledTimes(4);
    expect(mockReadUpstream).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstream).toHaveBeenCalledWith('market-intelligence');
    expect(mockReadUpstream).toHaveBeenCalledWith('portfolio-engine');
    expect(mockReadUpstream).toHaveBeenCalledWith('advisory-narrative');
    expect(result.investorProfileOutput).toEqual({ test: true });
  });

  it('returns null for missing outputs', async () => {
    mockReadUpstream.mockResolvedValue([]);

    const result = await handler({ decisionId: 'dec-1', tenantId: 'tenant-1' });

    expect(result.investorProfileOutput).toBeNull();
  });
});
```

**Note:** The AssemblePacket Lambda is provisioned via `NodejsFunction` in the CDK stack (Task 2.2), not via `additionalEntryPoints` in project.json.

- [ ] Run tests:

```
pnpm nx test decision-workflow-ctrl --testPathPattern=assemble-packet
```

**Commit:** `feat(decision-workflow-ctrl): add AssembleDecisionPacket Lambda handler`

### Task 4.3 — Simplify state machine (remove upstreamOutputs threading)

- [ ] Read `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`

- [ ] Modify `createAgentInvocationState`:
  - Remove `upstreamOutputs` from the event Detail template
  - Payload becomes `{ decisionId, tenantId, taskToken }` only

- [ ] Modify `MergeParallelOutputs` Pass state:
  - Remove output merging logic — pass through `{ decisionId, tenantId }` only

- [ ] Replace `AssembleDecisionPacket` Pass state with a Lambda Task state:
  - Use the new `assemble-packet` Lambda
  - Pass `{ decisionId, tenantId }` as input
  - Output feeds into downstream states (RECOMMENDATION_PROPOSED)

- [ ] Run all decision-workflow-ctrl tests:

```
pnpm nx test decision-workflow-ctrl
```

**Commit:** `refactor(decision-workflow-ctrl): simplify state machine — remove upstreamOutputs threading`

### Task 4.4 — Simplify event-listener completion handling

- [ ] Read `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`

- [ ] Modify completion event handlers (INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED):
  - Remove `outputs` extraction from event payload
  - Call `SendTaskSuccess(taskToken, { decisionId })` instead of `SendTaskSuccess(taskToken, outputs)`
  - Remove call to `repository.storeAgentOutput(...)` (method no longer exists)

- [ ] Read + update `services/advisory/decision-workflow-ctrl/test/event-listener.test.ts`:
  - Remove `outputs` from test event payloads
  - Assert `SendTaskSuccess` receives `{ decisionId }` only
  - Remove `storeAgentOutput` mock assertions

- [ ] Run tests:

```
pnpm nx test decision-workflow-ctrl
```

**Commit:** `refactor(decision-workflow-ctrl): simplify completion events — outputs read from Memory`

### Task 4.5 — Final validation

- [ ] Run all affected project tests:

```
pnpm nx run-many -t test --projects=agent-core,decision-workflow-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl
```

Expected: all tests pass

- [ ] Run lint:

```
pnpm nx run-many -t lint --projects=agent-core,decision-workflow-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl
```

**Commit:** (no commit — validation only)

> Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
