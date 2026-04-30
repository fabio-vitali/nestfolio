# Advisory Pipeline Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the legacy advisory-ctrl service entirely, align the AgentCore Memory write/read contract, and migrate consumer imports off `@nestfolio/advisory-ctrl/events` so the advisory data plane is single-sourced through `decision-workflow-ctrl`.

**Architecture:** Nine-phase rollout. Phase 0 is library-internal and ships independently. Phases 1-3 migrate consumer imports (advisory-bff, compliance-ctrl, e2e-feature-tests) and update two stale comment blocks. Phase 4 is a verification gate. Phases 5-6 deploy the migrated consumers and tear down the advisory-ctrl CloudFormation stack in dev (destructive ops with explicit confirmation gates). Phase 7 deletes the source tree + tsconfig path mapping. Phase 8 rotates the architecture docs to "resolved" status. Phase 9 updates user auto-memory.

**Tech Stack:** TypeScript 5.x, Nx monorepo, AWS CDK (per-service Apps), Bedrock AgentCore SDK (`@aws-sdk/client-bedrock-agentcore@3.1012.0`), Jest with `aws-sdk-client-mock` style mocks, EventBridge, DynamoDB Streams (CDC). Spec: `docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md` (commit `60a17680`).

**Workstream conventions:**
- All commits go directly to `main` (no feature branch / PR ceremony).
- No `Co-Authored-By: Claude` attribution in commit messages.
- Phase 5 (deploy) and Phase 6 (destroy stack) require explicit user confirmation before running — they touch shared AWS state.
- Phases 0-4, 7, 8 are local + commits; safe to execute without per-phase user pause.

---

## File Structure (what gets touched)

**Created:** none. (Plan + spec exist already.)

**Modified:**
- `libs/agent-orchestrator/src/memory/memory-client.ts` — switch SDK commands (Phase 0)
- `libs/agent-orchestrator/test/memory-client.test.ts` — update mocks for new commands (Phase 0)
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` — update comment block (Phase 0)
- `services/advisory/advisory-bff/src/handlers/event-listener.ts` — import path swap (Phase 1)
- `services/advisory/advisory-bff/src/service.stack.ts` — import path swap (Phase 1)
- `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` — comment update (Phase 1)
- `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts` — comment update (Phase 1)
- `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts` — import path swap (Phase 1)
- `services/advisory/compliance-ctrl/src/service.stack.ts` — import path swap (Phase 2)
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` — import path swap (Phase 2)
- `apps/e2e-feature-tests/src/helpers/fixtures.ts` — import path swap (Phase 3)
- `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — remove `decisionLifecycle` entry (Phase 3)
- `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` — import path swap (Phase 3)
- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` — swap `decisionLifecycle` trap → `advisoryNarrative` (Phase 3)
- `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts` — same swap (Phase 3)
- `tsconfig.base.json` — remove path mapping line 44 (Phase 7)
- `docs/architecture/SYSTEM-ARCHITECTURE.md` — §7.1, §10.1, §17.1, §21 OQ #3, §21 OQ #7 (Phase 8)
- `docs/architecture/SERVICE-INVENTORY.md` — drop advisory-ctrl entry, decrement totals (Phase 8)
- `services/advisory/compliance-ctrl/CLAUDE.md` — regenerate via audit-service skill (Phase 8)

**Deleted:**
- `services/advisory/advisory-ctrl/` — entire Nx project (Phase 7)
- `dev-advisory-ctrl` CloudFormation stack in AWS (Phase 6)

**User auto-memory (NOT in repo, no commits):**
- `MEMORY.md` — service count, decision cycle size, Spec 2 ship note (Phase 9)
- `project_advisory_pipeline_consolidation.md` — new topic file (Phase 9)
- `project_system_architecture_docs.md` — append Spec 2 ship note (Phase 9)

---

## Phase 0 — AgentCore Memory client redesign

Library-internal change. No service-level coupling. Ships independently of the consolidation. TDD: rewrite the existing test to expect the new commands (red), then update the implementation (green).

### Task 0.1: Update `memory-client.test.ts` to mock the new SDK commands

**Files:**
- Modify: `libs/agent-orchestrator/test/memory-client.test.ts`

- [ ] **Step 1: Replace the test file with the updated mocks**

Replace the entire contents of `libs/agent-orchestrator/test/memory-client.test.ts` with:

```typescript
import { createMemoryClient } from '../src/memory/memory-client';
import { createNoOpMemoryClient } from '../src/memory/no-op-client';

jest.mock('@aws-sdk/client-bedrock-agentcore', () => {
  const sendMock = jest.fn();
  return {
    BedrockAgentCoreClient: jest.fn(() => ({ send: sendMock })),
    BatchCreateMemoryRecordsCommand: jest.fn((input) => ({ input, __type: 'BatchCreateMemoryRecords' })),
    ListMemoryRecordsCommand: jest.fn((input) => ({ input, __type: 'ListMemoryRecords' })),
    RetrieveMemoryRecordsCommand: jest.fn((input) => ({ input, __type: 'RetrieveMemory' })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } = jest.requireMock('@aws-sdk/client-bedrock-agentcore');

describe('createMemoryClient', () => {
  const config = {
    memoryId: 'mem-123',
    region: 'us-east-1',
    serviceName: 'investor-profile',
  };

  beforeEach(() => sendMock.mockReset());

  describe('openDecisionSession', () => {
    it('writeAgentOutput sends BatchCreateMemoryRecordsCommand against the decision namespace', async () => {
      sendMock.mockResolvedValue({});
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.writeAgentOutput({ goals: 'conservative' });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.__type).toBe('BatchCreateMemoryRecords');
      expect(cmd.input.memoryId).toBe('mem-123');
      expect(cmd.input.records).toHaveLength(1);
      expect(cmd.input.records[0].namespace).toBe('/investor-profile/tenant-1/decisions/dec-42');
      expect(cmd.input.records[0].content.text).toBe(JSON.stringify({ goals: 'conservative' }));
    });

    it('readUpstreamOutput sends ListMemoryRecordsCommand against the upstream service namespace', async () => {
      sendMock.mockResolvedValue({
        memoryRecordSummaries: [
          {
            content: { text: '{"signals":[]}' },
            score: 0.95,
            memoryRecordId: 'rec-1',
          },
        ],
      });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      const records = await session.readUpstreamOutput('market-intelligence');

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.__type).toBe('ListMemoryRecords');
      expect(cmd.input.memoryId).toBe('mem-123');
      expect(cmd.input.namespace).toBe('/market-intelligence/tenant-1/decisions/dec-42');
      expect(records).toHaveLength(1);
      expect(records[0].score).toBe(0.95);
      expect(records[0].memoryRecordId).toBe('rec-1');
      expect(records[0].content).toBe('{"signals":[]}');
    });

    it('readUpstreamOutput returns empty array when namespace has no records', async () => {
      sendMock.mockResolvedValue({ memoryRecordSummaries: undefined });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      const records = await session.readUpstreamOutput('portfolio-engine');

      expect(records).toEqual([]);
    });

    it('searchLongTermMemory still uses RetrieveMemoryRecordsCommand with searchQuery', async () => {
      sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.searchLongTermMemory('risk tolerance', 3);

      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.__type).toBe('RetrieveMemory');
      expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
      expect(cmd.input.searchCriteria.topK).toBe(3);
      expect(cmd.input.searchCriteria.searchQuery).toBe('risk tolerance');
    });
  });

  it('searchTenantMemory still uses RetrieveMemoryRecordsCommand with searchQuery', async () => {
    sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
    const client = createMemoryClient(config);

    await client.searchTenantMemory('tenant-1', 'past allocations');

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__type).toBe('RetrieveMemory');
    expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
    expect(cmd.input.searchCriteria.searchQuery).toBe('past allocations');
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

- [ ] **Step 2: Run the test to verify it fails (red)**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=memory-client`

Expected: FAIL with errors like "BatchCreateMemoryRecordsCommand is not a function" or "expected ... __type 'BatchCreateMemoryRecords', got 'CreateEvent'" — confirming the implementation still uses the old commands.

---

### Task 0.2: Update `memory-client.ts` to use the new SDK commands

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `libs/agent-orchestrator/src/memory/memory-client.ts` with:

```typescript
import {
  BedrockAgentCoreClient,
  BatchCreateMemoryRecordsCommand,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
} from '@aws-sdk/client-bedrock-agentcore';

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
  const client = new BedrockAgentCoreClient({ region: config.region });

  return {
    openDecisionSession(tenantId: string, decisionId: string): DecisionSession {
      return {
        async writeAgentOutput(output: Record<string, unknown>): Promise<void> {
          const namespace = `/${config.serviceName}/${tenantId}/decisions/${decisionId}`;
          await client.send(
            new BatchCreateMemoryRecordsCommand({
              memoryId: config.memoryId,
              records: [
                {
                  namespace,
                  content: { text: JSON.stringify(output) },
                },
              ],
            })
          );
        },

        async readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]> {
          const namespace = `/${upstreamService}/${tenantId}/decisions/${decisionId}`;
          const resp = await client.send(
            new ListMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace,
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },

        async searchLongTermMemory(query: string, topK = 5): Promise<MemoryRecord[]> {
          const namespace = `/${config.serviceName}/${tenantId}`;
          const resp = await client.send(
            new RetrieveMemoryRecordsCommand({
              memoryId: config.memoryId,
              namespace,
              searchCriteria: { searchQuery: query, topK },
            })
          );
          return (resp.memoryRecordSummaries ?? []).map(mapRecord);
        },
      };
    },

    async searchTenantMemory(tenantId: string, query: string, topK = 5): Promise<MemoryRecord[]> {
      const namespace = `/${config.serviceName}/${tenantId}`;
      const resp = await client.send(
        new RetrieveMemoryRecordsCommand({
          memoryId: config.memoryId,
          namespace,
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

- [ ] **Step 2: Run the test to verify it passes (green)**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=memory-client`

Expected: PASS — all describe blocks green.

- [ ] **Step 3: Run the full lib test suite to confirm no other consumer broke**

Run: `pnpm nx test agent-orchestrator`

Expected: PASS for all tests in the library.

---

### Task 0.3: Update `assemble-packet.ts` comment to reflect the fix

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:55-67`

- [ ] **Step 1: Replace the comment block**

Find this block (lines 55-67):

```typescript
    // The narrative agent's ExplainabilitySchema produces `rationale` (detailed
    // reasoning) and `summary` (short framing). Map to the read model's
    // `explanation` field — `rationale` first, fall back to `summary`. The
    // final placeholder covers the case where memory reads return empty:
    // AgentCore strategy namespaces (e.g. /advisory-narrative/{actorId}/preferences)
    // do not align with the read path /advisory-narrative/{actorId}/decisions/{decisionId}
    // used by the memory client, so the agents' content rarely round-trips.
    // The placeholder keeps explanation non-empty so the read model satisfies
    // its String! schema contract and the UI renders the rationale block.
    const explanation =
      (narrativeOutput?.rationale as string | undefined) ??
      (narrativeOutput?.summary as string | undefined) ??
      `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;
```

Replace with:

```typescript
    // The narrative agent's ExplainabilitySchema produces `rationale` (detailed
    // reasoning) and `summary` (short framing). Map to the read model's
    // `explanation` field — `rationale` first, fall back to `summary`. The
    // final placeholder is defence-in-depth for the rare case where the upstream
    // Memory read returns no record (e.g. transient AgentCore unavailability or
    // an agent that ran but failed to persist its output). With the Memory client
    // contract aligned (Spec 2 — direct record write + list-records read against
    // the same /agent/{tenant}/decisions/{decisionId} namespace), this read
    // returns the agent's structured output as the primary path.
    const explanation =
      (narrativeOutput?.rationale as string | undefined) ??
      (narrativeOutput?.summary as string | undefined) ??
      `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;
```

- [ ] **Step 2: Run the assemble-packet unit test to confirm no behavior regression**

Run: `pnpm nx test decision-workflow-ctrl -- --testPathPattern=assemble-packet`

Expected: PASS.

---

### Task 0.4: Commit Phase 0

- [ ] **Step 1: Stage and commit**

```bash
git add libs/agent-orchestrator/src/memory/memory-client.ts \
        libs/agent-orchestrator/test/memory-client.test.ts \
        services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts

git commit -m "$(cat <<'EOF'
fix(agent-orchestrator): align Memory write/read contract per Spec 2

writeAgentOutput now uses BatchCreateMemoryRecordsCommand against
/{serviceName}/{tenantId}/decisions/{decisionId}. readUpstreamOutput now
uses ListMemoryRecordsCommand against the same namespace. Reads find what
writes produce — symmetric, deterministic, no semantic-search misuse on
transient decision payloads.

searchLongTermMemory and searchTenantMemory still use
RetrieveMemoryRecordsCommand with a searchQuery — semantic recall is the
correct behaviour over the long-term namespaces (preferences, signals,
rationale).

Resolves SYSTEM-ARCHITECTURE.md §17.1 + §21 Open Questions #3 and #7.

assemble-packet.ts comment updated: the namespace-mismatch explanation
no longer applies; the placeholder fallback is now true defence-in-depth.
EOF
)"
```

- [ ] **Step 2: Verify commit**

Run: `git log -1 --stat`

Expected: One commit on `main`, three files modified.

---

## Phase 1 — advisory-bff import migration

Pure import-path swap from `@nestfolio/advisory-ctrl/events` to `@nestfolio/decision-workflow-ctrl/events`. The three event names in use (`DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `USER_CONFIRMATION_REQUESTED`) already exist in `DecisionWorkflowEventTypes` (verified at `services/advisory/decision-workflow-ctrl/src/domain/events.ts:6,7,17`).

### Task 1.1: Update `service.stack.ts` imports

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts:5,17,18,21`

- [ ] **Step 1: Edit the import line**

Find line 5:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the eventTypes array references**

Find lines 17-21:

```typescript
      eventTypes: [
        AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
        AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED,
        ComplianceEventTypes.DECISION_APPROVED,
        ComplianceEventTypes.DECISION_BLOCKED,
        AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED,
      ],
```

Replace with:

```typescript
      eventTypes: [
        DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
        DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
        ComplianceEventTypes.DECISION_APPROVED,
        ComplianceEventTypes.DECISION_BLOCKED,
        DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED,
      ],
```

---

### Task 1.2: Update `event-listener.ts` imports

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts:2,9,11,17`

- [ ] **Step 1: Edit the import line**

Find line 2:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the handler-key references**

Find lines 9, 11, 17 (the three handler keys):

```typescript
    [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED]: (payload: any, ctx: any) =>
      decisionPacketCreated(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_APPROVED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_BLOCKED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
```

Replace with:

```typescript
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: (payload: any, ctx: any) =>
      decisionPacketCreated(toUow(payload, ctx) as any),
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_APPROVED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_BLOCKED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
```

---

### Task 1.3: Update `event-listener.test.ts` imports

**Files:**
- Modify: `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts:2`

- [ ] **Step 1: Read the current file to find existing references**

Run: `grep -n "AdvisoryCtrlEventTypes\|@nestfolio/advisory-ctrl" services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts`

Expected output (verified by Grep at plan-write time):
```
2:import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
10:    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED);
11:    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED);
14:    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED);
```

- [ ] **Step 2: Replace all `AdvisoryCtrlEventTypes` references with `DecisionWorkflowEventTypes`**

Edit line 2:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

→

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

Replace `AdvisoryCtrlEventTypes` with `DecisionWorkflowEventTypes` on lines 10, 11, 14 (use Edit's `replace_all: true` for `AdvisoryCtrlEventTypes` → `DecisionWorkflowEventTypes` within this file only).

---

### Task 1.4: Update `decision-packet-created.ts` comment block

**Files:**
- Modify: `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts:13-20`

The current comment describes the dual-emitter race that Spec 2 resolves. The defensive `if (!hasExplanation && !hasTrades) return undefined;` skip is kept (defence-in-depth costs nothing) but the rationale changes.

- [ ] **Step 1: Replace the comment block**

Find lines 13-20:

```typescript
// Two services emit DECISION_PACKET_CREATED for the same decision: advisory-ctrl
// writes an empty packet first (its sync agent pipeline regularly hits the 30s
// Lambda timeout before the follow-up update with explanation can fire), and
// decision-workflow-ctrl's AssemblePacket lands a packet with the synthesized
// explanation seconds later. `record()` is putIfNotExists, so whichever event
// arrives first wins — and the empty advisory-ctrl event arrives first because
// its DDB write is synchronous on the trigger. Skip events that carry no
// explanation so the populated event from the other source creates the row.
```

Replace with:

```typescript
// Defence-in-depth: skip DECISION_PACKET_CREATED events that carry neither
// explanation nor proposed trades. Post-Spec-2 the sole emitter is
// decision-workflow-ctrl's AssemblePacket (assemble-packet.ts:75-86), which
// always lands the row populated, so this skip should never fire in practice.
// Keeping it cheap protects against degraded paths (e.g. AgentCore returning
// empty narrative output) producing an empty read-model row.
```

---

### Task 1.5: Update `decision-status-changed.ts` comment block

**Files:**
- Modify: `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts:32-37`

- [ ] **Step 1: Replace the comment block**

Find lines 32-37:

```typescript
  // advisory-ctrl emits DECISION_PACKET_UPDATED with the assembled explanation
  // and proposedTrades on subject after its agent pipeline completes. The CREATE
  // event that preceded this UPDATE landed an empty row (advisory-ctrl writes
  // an empty packet first, then updates with content). Copy these fields when
  // present so the read model carries the agent-produced narrative the UI's
  // .rationale element renders.
```

Replace with:

```typescript
  // Copy explanation and proposedTrades from the subject when present.
  // Post-Spec-2, AssemblePacket lands the CREATE event with these fields
  // already populated and DECISION_PACKET_UPDATED rarely carries them again.
  // Preserved as a no-op safety net: if a future producer emits an UPDATE with
  // newly-synthesized content, the read model picks it up without code change.
```

---

### Task 1.6: Run advisory-bff test suite

- [ ] **Step 1: Run unit + transform tests**

Run: `pnpm nx test advisory-bff`

Expected: PASS — all tests green.

- [ ] **Step 2: Run lint**

Run: `pnpm nx lint advisory-bff`

Expected: PASS.

- [ ] **Step 3: Run build (CDK synth)**

Run: `pnpm nx build advisory-bff`

Expected: PASS.

---

### Task 1.7: Commit Phase 1

- [ ] **Step 1: Stage and commit**

```bash
git add services/advisory/advisory-bff/

git commit -m "$(cat <<'EOF'
refactor(advisory-bff): migrate event-type imports to decision-workflow-ctrl

DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, and USER_CONFIRMATION_REQUESTED
all already exist in DecisionWorkflowEventTypes — the canonical owner of these
events post-Spec-2 (decision-workflow-ctrl is the sole emitter).

Wire-level subscriptions are unchanged. Lambda bundle hashes change because the
imports now resolve to a different package path.

Comment blocks in transforms/decision-packet-created.ts and
transforms/decision-status-changed.ts updated: the dual-emitter race
description no longer applies.

Step toward Spec 2 — advisory pipeline consolidation
(docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md).
EOF
)"
```

- [ ] **Step 2: Verify commit**

Run: `git log -1 --stat`

Expected: One commit, modifying 5 files under `services/advisory/advisory-bff/`.

---

## Phase 2 — compliance-ctrl import migration

Pure import-path swap. `RECOMMENDATION_PROPOSED` already exists in `DecisionWorkflowEventTypes` at `services/advisory/decision-workflow-ctrl/src/domain/events.ts:16`. Wire-level trigger, payload shape, taskToken propagation, and end-to-end behaviour are unchanged.

### Task 2.1: Update `service.stack.ts` imports

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts:4,16`

- [ ] **Step 1: Edit the import line**

Find line 4:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the eventTypes array reference**

Find line 16:

```typescript
        AdvisoryCtrlEventTypes.RECOMMENDATION_PROPOSED,
```

Replace with:

```typescript
        DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED,
```

---

### Task 2.2: Update `event-listener.ts` imports

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts:5,202`

- [ ] **Step 1: Edit the import line**

Find line 5:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the handler-key reference**

Find line 202:

```typescript
  handlers[AdvisoryCtrlEventTypes.RECOMMENDATION_PROPOSED] = (payload, ctx) =>
```

Replace with:

```typescript
  handlers[DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED] = (payload, ctx) =>
```

---

### Task 2.3: Confirm test files have no `AdvisoryCtrlEventTypes` import

The `compliance-ctrl/test/unit/event-listener.test.ts` and `compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts` files use the literal string `'RECOMMENDATION_PROPOSED'` via `fakeSqsRecord(...)` and `detailType: 'RECOMMENDATION_PROPOSED'`, not the imported enum (verified at plan-write time).

- [ ] **Step 1: Confirm zero matches in test files**

Run: `grep -n "AdvisoryCtrlEventTypes\|@nestfolio/advisory-ctrl" services/advisory/compliance-ctrl/test/`

Expected: zero output (no matches).

If any matches surface, repeat the swap pattern from Tasks 2.1–2.2 for those files.

---

### Task 2.4: Run compliance-ctrl test suite

- [ ] **Step 1: Run unit tests**

Run: `pnpm nx test compliance-ctrl`

Expected: PASS — all unit tests green. Test fixtures use literal strings; assertions unchanged.

- [ ] **Step 2: Run lint**

Run: `pnpm nx lint compliance-ctrl`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `pnpm nx build compliance-ctrl`

Expected: PASS.

---

### Task 2.5: Commit Phase 2

- [ ] **Step 1: Stage and commit**

```bash
git add services/advisory/compliance-ctrl/

git commit -m "$(cat <<'EOF'
refactor(compliance-ctrl): migrate RECOMMENDATION_PROPOSED import to decision-workflow-ctrl

RECOMMENDATION_PROPOSED is the canonical SF→compliance-ctrl trigger emitted by
decision-workflow-ctrl's WaitForCompliance state (see decision-state-machine.ts:159-177)
carrying the SF taskToken in subject.taskToken. The event already exists in
DecisionWorkflowEventTypes; this is a pure import-path migration.

Wire-level trigger, payload shape, taskToken propagation, and end-to-end
behaviour are unchanged. Test fixtures use literal strings, so test files
need no edits.

Step toward Spec 2 — advisory pipeline consolidation.
EOF
)"
```

---

## Phase 3 — e2e-feature-tests migration

Two parts: (a) import-path swaps in `fixtures.ts` and `operating-mode-authority.e2e.test.ts`; (b) removing the `decisionLifecycle` agent-trace probe + migrating its two consumer tests to use the surviving `advisoryNarrative` trap as the closest analog.

The `decisionLifecycle` trap was a probe for the legacy 6-agent monolith's composite trace event. With the monolith gone (Phase 7), no producer ever emits that trace again. The two consuming tests (`first-decision.e2e.test.ts` and `reconciliation-correction.e2e.test.ts`) currently `arm()` the trap and `waitFor()` traces with `getLatencyBudget()` — these are pathological-regression canaries, not load-bearing assertions. Migrating them to `advisoryNarrative` (the last of the 4-agent waves, the closest "decision is done" signal) preserves the canary intent.

### Task 3.1: Update `fixtures.ts` import

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts:14,172`

- [ ] **Step 1: Edit the import line**

Find line 14:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the detailType reference**

Find line 172:

```typescript
      detailType: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
```

Replace with:

```typescript
      detailType: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
```

---

### Task 3.2: Update `operating-mode-authority.e2e.test.ts` import

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts:8,124`

- [ ] **Step 1: Edit the import line**

Find line 8:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Replace with:

```typescript
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 2: Edit the detailType reference**

Find line 124:

```typescript
      detailType: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
```

Replace with:

```typescript
      detailType: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
```

---

### Task 3.3: Remove `decisionLifecycle` from `agent-trace-trap.ts`

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`

- [ ] **Step 1: Drop the AdvisoryCtrlEventTypes import**

Find line 7:

```typescript
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
```

Delete this line entirely.

- [ ] **Step 2: Remove the `decisionLifecycle` entry from `AGENT_TRACE_EVENTS`**

Find lines 24-27:

```typescript
  decisionLifecycle: {
    bus: 'advisory' as const,
    detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
  },
```

Delete this entry entirely. The surrounding `AGENT_TRACE_EVENTS` object now has 5 entries (advisoryNarrative, portfolioEngine, investorProfile, marketIntelligence, onboarding).

- [ ] **Step 3: Remove the `decisionLifecycle` latency budget**

Find lines 50-54:

```typescript
    // Decision-lifecycle orchestrates 6 agents across 3 sequential waves
    // (profiling → construction → explainability) with tier escalation and
    // tool calls; real p95 lands ~80s. Budget keeps headroom for jitter but
    // still catches multi-minute pathologies.
    decisionLifecycle: 180_000,
```

Delete this entry (and the four-line comment block above it).

- [ ] **Step 4: Confirm AgentKey is still derived correctly**

`type AgentKey = keyof typeof AGENT_TRACE_EVENTS;` (line 38) automatically narrows to the 5 remaining keys — no edit needed.

---

### Task 3.4: Migrate `first-decision.e2e.test.ts` from `decisionLifecycle` → `advisoryNarrative`

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:18,30,83,94`

- [ ] **Step 1: Read the test to understand the trap usage**

Run: `grep -n "decisionLifecycle\|advisoryNarrative" apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`

Expected output:
```
18:  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;
30:    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
83:    const dlTraces = await decisionLifecycleTrap.waitFor({
94:      decisionLifecycleTrap.getLatencyBudget(),
```

- [ ] **Step 2: Replace the four occurrences**

Use Edit's `replace_all: true` within this file:

| Find | Replace with |
|---|---|
| `decisionLifecycleTrap` | `advisoryNarrativeTrap` |
| `'decisionLifecycle'` | `'advisoryNarrative'` |
| `dlTraces` | `narrativeTraces` |

Use three separate `replace_all` Edit calls (one per substitution) to avoid collisions.

- [ ] **Step 3: Verify the edits**

Run: `grep -n "decisionLifecycle\|advisoryNarrative\|dlTraces\|narrativeTraces" apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`

Expected: zero matches for `decisionLifecycle`, `dlTraces`. Four matches for `advisoryNarrative` / `narrativeTraces`.

---

### Task 3.5: Migrate `reconciliation-correction.e2e.test.ts` from `decisionLifecycle` → `advisoryNarrative`

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts:28,37,121,132`

- [ ] **Step 1: Read the test to confirm the trap usage**

Run: `grep -n "decisionLifecycle\|advisoryNarrative" apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`

Expected output:
```
28:  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;
37:    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
121:    const dlTraces = await decisionLifecycleTrap.waitFor({
132:      decisionLifecycleTrap.getLatencyBudget(),
```

- [ ] **Step 2: Apply the same three `replace_all` substitutions as Task 3.4**

| Find | Replace with |
|---|---|
| `decisionLifecycleTrap` | `advisoryNarrativeTrap` |
| `'decisionLifecycle'` | `'advisoryNarrative'` |
| `dlTraces` | `narrativeTraces` |

- [ ] **Step 3: Verify**

Run: `grep -n "decisionLifecycle\|dlTraces" apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`

Expected: zero matches.

---

### Task 3.6: Run e2e-feature-tests build + lint

The e2e suite runs against deployed AWS — Jest tests are not run in this phase (they require `NESTFOLIO_INTEG_PREFIX=dev` and live infrastructure; smoke happens in Phase 5).

- [ ] **Step 1: Build (TypeScript compile)**

Run: `pnpm nx build e2e-feature-tests`

Expected: PASS — TypeScript catches any missing AgentKey usage.

- [ ] **Step 2: Lint**

Run: `pnpm nx lint e2e-feature-tests`

Expected: PASS.

---

### Task 3.7: Commit Phase 3

- [ ] **Step 1: Stage and commit**

```bash
git add apps/e2e-feature-tests/

git commit -m "$(cat <<'EOF'
refactor(e2e-feature-tests): migrate advisory-ctrl event imports + drop decisionLifecycle trap

fixtures.ts and operating-mode-authority.e2e.test.ts: import
DECISION_PACKET_CREATED from decision-workflow-ctrl/events.

agent-trace-trap.ts: drop the legacy decisionLifecycle entry
(DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED). With the 6-agent monolith
removed in Spec 2, no producer emits that trace.

first-decision.e2e.test.ts and reconciliation-correction.e2e.test.ts:
swap decisionLifecycle trap for advisoryNarrative — the last wave of the
canonical 4-agent pipeline, which serves as the closest analog signal
for "decision lifecycle complete". Latency-budget canary intent preserved.
EOF
)"
```

---

## Phase 4 — Pre-deletion verification gate

No commits in this phase — just verification. If any check fails, fix before proceeding to Phase 5.

### Task 4.1: Confirm zero remaining production references to `@nestfolio/advisory-ctrl`

- [ ] **Step 1: Grep for the package path**

Run: `grep -rn "@nestfolio/advisory-ctrl" services/ apps/ libs/ infrastructure/`

Expected: zero matches. If anything matches, that import was missed in Phases 1-3.

- [ ] **Step 2: Grep for the type name**

Run: `grep -rn "AdvisoryCtrlEventTypes" services/ apps/ libs/ infrastructure/ tools/`

Expected: only matches inside `services/advisory/advisory-ctrl/` itself (the project still exists; deletion is Phase 7).

---

### Task 4.2: Run affected build + test + lint

- [ ] **Step 1: Run nx affected**

Run: `pnpm nx affected -t build,test,lint --base=HEAD~5`

(`HEAD~5` covers Phases 0-3 commits.)

Expected: PASS for all affected projects.

If any test fails, debug and fix before continuing. Do not skip this gate.

---

## Phase 5 — Deploy migrated consumers (REQUIRES USER CONFIRMATION)

> **STOP — confirmation gate.** This phase modifies the dev sandbox AWS account (771924376645). Confirm with the user before running.
>
> Suggested message to user: *"Phase 4 verification passed. Ready to deploy compliance-ctrl + advisory-bff to dev sandbox via `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=compliance-ctrl,advisory-bff`. This is the first AWS-touching step. Confirm to proceed."*

### Task 5.1: Deploy migrated consumers

- [ ] **Step 1: Run the deploy command**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=compliance-ctrl,advisory-bff`

Expected: both stacks update successfully. Look for `dev-compliance-ctrl: UPDATE_COMPLETE` and `dev-advisory-bff: UPDATE_COMPLETE` (or `CREATE_COMPLETE` if they were previously destroyed).

- [ ] **Step 2: Verify Lambda function code hashes changed**

Run: `aws lambda get-function --function-name dev-compliance-ctrl-event-listener --query 'Configuration.CodeSha256' --output text` (and similarly for `dev-advisory-bff-event-listener`)

Expected: a new sha256 value vs. pre-deploy. (Optional verification — UPDATE_COMPLETE from CFN is sufficient.)

---

### Task 5.2: Smoke test — exactly one `DECISION_PACKET_CREATED` per decision

- [ ] **Step 1: Identify a recent decisionId from CloudWatch**

Run: `aws logs filter-log-events --log-group-name /aws/lambda/dev-advisory-bff-event-listener --filter-pattern '"DECISION_PACKET_CREATED"' --start-time $(($(date +%s%N) / 1000000 - 3600000)) --max-items 5 --query 'events[*].message' --output text | head -20`

(Last hour, up to 5 matches.)

- [ ] **Step 2: For each unique `decisionId` returned, count occurrences**

Run: `aws logs filter-log-events --log-group-name /aws/lambda/dev-advisory-bff-event-listener --filter-pattern "<decisionId>" --start-time $(($(date +%s%N) / 1000000 - 3600000)) --query 'events[*].message' --output text | grep -c DECISION_PACKET_CREATED`

Expected: exactly **1** DECISION_PACKET_CREATED per decisionId. (If 2, the dual-emitter race is still firing — Phase 6 is not safe yet.)

- [ ] **Step 3: If no recent decisions exist, trigger one**

Run a single e2e scenario in dev:

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=operating-mode-authority
```

Then re-run Step 2 against the new decisionId.

If smoke passes (exactly one DECISION_PACKET_CREATED per decisionId), proceed to Phase 6. If it shows two, advisory-ctrl's CDC is still emitting — investigate before destroying the stack.

---

## Phase 6 — Destroy advisory-ctrl AWS stack (DESTRUCTIVE — REQUIRES USER CONFIRMATION)

> **STOP — destructive operation.** Confirm with the user before running. This deletes the `dev-advisory-ctrl` CloudFormation stack and its DynamoDB table. Per `feedback_no_deprecation.md`, dev is disposable, but the destroy is irreversible.
>
> Suggested message: *"Phase 5 smoke confirms one DECISION_PACKET_CREATED per decision. Ready to destroy `dev-advisory-ctrl` CloudFormation stack via `pnpm nx destroy advisory-ctrl --prefix=dev`. This deletes the legacy DynamoDB table, Lambda functions, AgentRuntime + ECR image references, and four tool Lambdas in dev. Confirm to proceed."*

### Task 6.1: Destroy the stack

- [ ] **Step 1: Run the destroy target**

Run: `pnpm nx destroy advisory-ctrl --prefix=dev`

Expected: CDK destroys the stack. Output ends with `dev-advisory-ctrl: DELETE_COMPLETE`. Takes 2-5 minutes.

- [ ] **Step 2: Verify stack is gone**

Run: `aws cloudformation describe-stacks --stack-name dev-advisory-ctrl 2>&1 | grep -i 'does not exist\|StackId'`

Expected: error containing "does not exist" — confirming deletion. (If the stack still shows, wait 30s and re-check; CFN deletion is async at the edges.)

- [ ] **Step 3: Verify the DDB table is gone**

Run: `aws dynamodb describe-table --table-name dev-advisory-ctrl 2>&1 | grep -i 'ResourceNotFound\|Table'`

Expected: `ResourceNotFoundException`.

---

## Phase 7 — Delete advisory-ctrl source tree

CloudFormation stack is gone. Now remove the source.

### Task 7.1: Delete the project directory

**Files:**
- Delete: `services/advisory/advisory-ctrl/` (entire directory)

- [ ] **Step 1: Delete the directory**

Run: `rm -rf services/advisory/advisory-ctrl`

Expected: command returns silently with exit 0.

- [ ] **Step 2: Verify deletion**

Run: `ls services/advisory/`

Expected: no `advisory-ctrl` entry. The directory listing should show 14 entries (down from 15).

---

### Task 7.2: Remove the tsconfig path mapping

**Files:**
- Modify: `tsconfig.base.json:44`

- [ ] **Step 1: Find and delete the path mapping line**

Find line 44 (verified at plan-write time):

```json
      "@nestfolio/advisory-ctrl/events": ["services/advisory/advisory-ctrl/src/domain/events.ts"],
```

Delete this line entirely. The line above (43, `@nestfolio/onboarding-bff/events`) and the line below (45, `@nestfolio/advisory-bff/events`) should remain.

- [ ] **Step 2: Verify**

Run: `grep -n "advisory-ctrl" tsconfig.base.json`

Expected: zero matches.

---

### Task 7.3: Run global build + test + lint

- [ ] **Step 1: Run full nx graph + affected**

Run: `pnpm nx run-many -t build,test,lint --all --parallel=4`

Expected: PASS for all projects. The Nx graph must no longer reference advisory-ctrl.

If any project fails, the failure should be one of:
- A leftover import that wasn't migrated → fix and re-run.
- A project still depending on advisory-ctrl → unlikely, since Phase 4 already verified zero references.

- [ ] **Step 2: Confirm Nx project list**

Run: `pnpm nx show projects | grep -c advisory-ctrl`

Expected: `0`.

---

### Task 7.4: Commit Phase 7

- [ ] **Step 1: Stage and commit**

```bash
git add services/advisory/advisory-ctrl tsconfig.base.json

git commit -m "$(cat <<'EOF'
chore(advisory): remove advisory-ctrl service entirely (Spec 2)

The legacy 6-agent decision-lifecycle service is fully redundant with
decision-workflow-ctrl on the data plane (TriggerIngress + SF orchestration
+ AssemblePacket emission). Its control-plane scope (model lifecycle,
incidents, budgets, reasoning tier — 19 typed events with no producers)
is renounced.

Deletes:
- services/advisory/advisory-ctrl/ (entire Nx project, src, tests, agents,
  prompts, tools, Dockerfile, integration tests, mocks, CLAUDE.md)
- tsconfig.base.json @nestfolio/advisory-ctrl/events path mapping

CloudFormation stack dev-advisory-ctrl was destroyed in the prior step.

Service count: 33 → 32. Resolves SYSTEM-ARCHITECTURE.md §10.1 dual-emitter
race (only decision-workflow-ctrl emits DECISION_PACKET_CREATED) and
collapses Intelligence layer to exactly 4 services (§7.1).
EOF
)"
```

- [ ] **Step 2: Verify commit**

Run: `git log -1 --stat | head -10`

Expected: a large diff (hundreds of files deleted under `services/advisory/advisory-ctrl/`).

---

## Phase 8 — Documentation rotation

### Task 8.1: Update SYSTEM-ARCHITECTURE.md §7.1

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Read current §7.1 to capture exact text**

Run: `awk '/^### 7\.1/,/^## 8\./' docs/architecture/SYSTEM-ARCHITECTURE.md`

(Captures everything from §7.1 header to §8 header — adjust the lower bound to the actual next section.)

- [ ] **Step 2: Replace the §7.1 body**

Replace the §7.1 body with text along these lines (preserve §7.1 header and the section that follows):

```markdown
### 7.1 Architectural Evolution — 6→4 advisory agent decomposition

**Resolved 2026-04-30 (Spec 2).** The legacy 6-agent advisory-ctrl service was removed. The Intelligence layer is exactly four services: investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl. Drivers of the decomposition: per-agent Memory locality (each agent owns its namespace and resource ARN), per-agent observability (independent trace channels via `*_AGENT_INVOCATION_TRACED`), per-agent runtime independence (independent ECR images, deploy cadence, and AgentCore lifecycle). The orchestrator role passed to decision-workflow-ctrl, which composes the four agents via Step Functions task tokens.
```

(Adjust prose if the existing section had useful detail worth preserving — the goal is "Resolved" status with brief drivers.)

---

### Task 8.2: Update SYSTEM-ARCHITECTURE.md §10.1

- [ ] **Step 1: Replace the §10.1 body**

Find the §10.1 block (verified at plan-write time around lines 246-260) and replace with:

```markdown
### 10.1 Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters

**Resolved 2026-04-30 (Spec 2).** The legacy emitter (advisory-ctrl CDC on its DecisionPacket row) was removed when advisory-ctrl was deleted in full. `decision-workflow-ctrl`'s `AssemblePacket` Lambda is now the sole canonical emitter. The CQRS race symptom observed in the 8th-session Playwright run (DECISION_PACKET_UPDATED arriving before CREATED, sparse advisory-bff projection rows) cannot recur — there is no second producer.

Defence-in-depth retained in `advisory-bff/transforms/decision-packet-created.ts`: the transform skips events that carry neither `explanation` nor `proposedTrades`. With one emitter that always lands the row populated, this skip should never fire — but it cheaply protects against degraded paths (e.g. AgentCore returning empty narrative output).
```

---

### Task 8.3: Update SYSTEM-ARCHITECTURE.md §17.1

- [ ] **Step 1: Replace the §17.1 body**

Find the §17.1 block (around lines 425-440) and replace with:

```markdown
### 17.1 Architectural Evolution — Current implementation diverges from contract

**Resolved 2026-04-30 (Spec 2).** `libs/agent-orchestrator/src/memory/memory-client.ts` now uses symmetric write/read commands against the same namespace.

- **Write** — `writeAgentOutput` calls `BatchCreateMemoryRecordsCommand` with `records[0].namespace = /{serviceName}/{tenantId}/decisions/{decisionId}`. Writes a memory record directly addressable by namespace.
- **Read** — `readUpstreamOutput(upstreamService)` calls `ListMemoryRecordsCommand` against `/{upstreamService}/{tenantId}/decisions/{decisionId}`. Returns all records in the namespace, deterministic and complete.

Reads find what writes produce. The placeholder fallback in `decision-workflow-ctrl/handlers/assemble-packet.ts:64-67` becomes true defence-in-depth (degraded-path safety) rather than the always-hit primary path it was during the divergence.

`searchLongTermMemory` and `searchTenantMemory` continue to use `RetrieveMemoryRecordsCommand` with a `searchQuery` — semantic recall is the correct semantic over the long-term namespaces (`preferences`, `signals`, `rationale`) where Bedrock extraction strategies are attached.
```

---

### Task 8.4: Close §21 Open Questions #3 and #7

- [ ] **Step 1: Find the OQ list**

Run: `awk '/^## 21\./,/^## 22\./' docs/architecture/SYSTEM-ARCHITECTURE.md | head -40`

- [ ] **Step 2: Replace OQ #3**

Find the OQ #3 line (currently mentioning "AgentCore Memory namespace mismatch ... Spec 2 lands the alignment"):

```markdown
3. **AgentCore Memory namespace mismatch.** `writeAgentOutput` writes session events; `readUpstreamOutput` reads memory records. **Spec 2** lands the alignment.
```

Replace with:

```markdown
3. ~~AgentCore Memory namespace mismatch.~~ **Closed 2026-04-30 by Spec 2** — `writeAgentOutput` now uses `BatchCreateMemoryRecordsCommand`, `readUpstreamOutput` uses `ListMemoryRecordsCommand`, both against `/{service}/{tenant}/decisions/{decisionId}`. See §17.1.
```

- [ ] **Step 3: Replace OQ #7**

Find the OQ #7 line (currently mentioning "decisions/{decisionId} namespace extraction strategy"):

```markdown
7. **`decisions/{decisionId}` namespace extraction strategy.** The contract specifies "no extraction strategy — raw retrieval" but the current `RetrieveMemoryRecordsCommand` call uses a `searchQuery` (`'agent output'`) which implies a search-backed retrieval, not a direct read. Revisit during Spec 2 — may want a different API call (e.g. list-records-by-namespace) for the canonical read.
```

Replace with:

```markdown
7. ~~`decisions/{decisionId}` namespace extraction strategy.~~ **Closed 2026-04-30 by Spec 2** — `ListMemoryRecordsCommand` (direct list-by-namespace) replaces the semantic-search read. No extraction strategy needed on the namespace.
```

---

### Task 8.5: Update SERVICE-INVENTORY.md — drop advisory-ctrl, decrement totals

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

- [ ] **Step 1: Find the advisory-ctrl entry**

Run: `awk '/^### advisory-ctrl/,/^### /' docs/architecture/SERVICE-INVENTORY.md | head -40`

(Captures the advisory-ctrl section to the next service section.)

- [ ] **Step 2: Delete the entire advisory-ctrl entry**

Remove the `### advisory-ctrl` heading and all its body content, up to (but not including) the next service heading.

- [ ] **Step 3: Update the totals**

Find the document header / domain totals (typically at the top or in a summary table):
- Total services: `33` → `32`
- Advisory domain count: decrement by 1
- Health-tag tally: re-count after removing the advisory-ctrl entry (its Health was `transitional`, so the transitional bucket drops by 1)

If a section explicitly states "Advisory domain: N services" with a count, edit that count.

---

### Task 8.6: Regenerate `compliance-ctrl/CLAUDE.md` via the audit-service skill

The current card claims subscriptions to `DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED` — but the actual code subscribes to `RECOMMENDATION_PROPOSED` + the three mandate events. Stale.

- [ ] **Step 1: Invoke the audit-service skill**

Use the `Skill` tool: `Skill(skill: "audit-service", args: "compliance-ctrl")`

The skill regenerates `services/advisory/compliance-ctrl/CLAUDE.md` from the current code state.

- [ ] **Step 2: Spot-check the output**

Run: `grep -n "Subscriptions\|RECOMMENDATION_PROPOSED" services/advisory/compliance-ctrl/CLAUDE.md`

Expected: the new card should list `RECOMMENDATION_PROPOSED, MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED` under Subscriptions.

---

### Task 8.7: Commit Phase 8

- [ ] **Step 1: Stage and commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md \
        docs/architecture/SERVICE-INVENTORY.md \
        services/advisory/compliance-ctrl/CLAUDE.md

git commit -m "$(cat <<'EOF'
docs(arch): rotate to Resolved — Spec 2 architectural evolutions closed

SYSTEM-ARCHITECTURE.md:
- §7.1: 6→4 advisory agent decomposition → Resolved 2026-04-30
- §10.1: dual DECISION_PACKET_CREATED emitters → Resolved 2026-04-30
- §17.1: AgentCore Memory namespace divergence → Resolved 2026-04-30
- §21 Open Question #3 (Memory namespace mismatch) → Closed
- §21 Open Question #7 (decisions/{decisionId} extraction strategy) → Closed

SERVICE-INVENTORY.md:
- Drop advisory-ctrl entry
- Service count: 33 → 32
- Advisory domain count decremented; transitional Health bucket -1

services/advisory/compliance-ctrl/CLAUDE.md:
- Regenerated via audit-service skill — actual subscriptions are
  RECOMMENDATION_PROPOSED + the three mandate events, not the
  pre-emptively documented DECISION_PACKET_* set.
EOF
)"
```

---

## Phase 9 — User auto-memory updates

User auto-memory lives at `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/` and is **not in the repo** — no git operations.

### Task 9.1: Update `MEMORY.md`

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`

- [ ] **Step 1: Update the Architecture section**

Find the line: `- 4 domains: Investor, Advisory, Execution, Ledger — 33 services total`

Replace `33 services total` with `32 services total`.

Find the line: `- Advisory decision cycle: 5 services (decision-workflow-ctrl orchestrates 4 LangGraph agents via SF task tokens)`

Replace `5 services` with `4 LangGraph agent services + decision-workflow-ctrl orchestrator (advisory-ctrl removed in Spec 2)`. (The old phrasing implied advisory-ctrl was part of the cycle — it never was post-decomposition.)

- [ ] **Step 2: Add a Recently Completed Work entry**

Insert at the top of "Recently Completed Work" (above the existing "Onboarding agent runtime redesign" entry):

```markdown
- **Advisory pipeline consolidation (Spec 2) — SHIPPED 2026-04-30** on `main`: deleted advisory-ctrl entirely (33→32 services), aligned AgentCore Memory write/read contract (BatchCreateMemoryRecordsCommand + ListMemoryRecordsCommand against same namespace), migrated advisory-bff + compliance-ctrl + e2e-feature-tests imports to `@nestfolio/decision-workflow-ctrl/events`, swapped two e2e tests' `decisionLifecycle` trap for `advisoryNarrative`. Resolves SYSTEM-ARCHITECTURE.md §7.1 + §10.1 + §17.1 + §21 OQ #3 + #7. Spec: `docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md`. See [project_advisory_pipeline_consolidation.md](./project_advisory_pipeline_consolidation.md).
```

- [ ] **Step 3: Add the topic file pointer**

In the "Topic Files" section, add:

```markdown
- [Advisory pipeline consolidation](./project_advisory_pipeline_consolidation.md) — SHIPPED 2026-04-30: advisory-ctrl removed entirely; Memory namespace aligned; consumer imports migrated.
```

---

### Task 9.2: Create `project_advisory_pipeline_consolidation.md`

**Files:**
- Create: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_advisory_pipeline_consolidation.md`

- [ ] **Step 1: Write the topic file**

Use this content:

```markdown
---
name: Advisory pipeline consolidation
description: Spec 2 of system architecture docs workstream — retired advisory-ctrl entirely, aligned AgentCore Memory contract, migrated consumer imports
type: project
---

# Advisory pipeline consolidation — SHIPPED 2026-04-30

## What shipped
- **advisory-ctrl deleted entirely** (33 → 32 services). The legacy 6-agent decision-lifecycle service was redundant with decision-workflow-ctrl on the data plane (TriggerIngress + SF orchestration + AssemblePacket emission). Control-plane scope (model lifecycle, incidents, budgets, reasoning tier — 19 typed events with no producers) was renounced.
- **AgentCore Memory contract aligned**: `writeAgentOutput` switched from `CreateEventCommand` to `BatchCreateMemoryRecordsCommand` against `/{serviceName}/{tenantId}/decisions/{decisionId}`. `readUpstreamOutput` switched from `RetrieveMemoryRecordsCommand` (semantic search) to `ListMemoryRecordsCommand` (direct list) against the same namespace. `searchLongTermMemory` + `searchTenantMemory` unchanged (semantic recall is correct over long-term namespaces).
- **Consumer imports migrated** from `@nestfolio/advisory-ctrl/events` to `@nestfolio/decision-workflow-ctrl/events`: advisory-bff (handlers + service.stack), compliance-ctrl (handlers + service.stack), e2e-feature-tests (fixtures + operating-mode-authority).
- **e2e agent-trace-trap pruned**: `decisionLifecycle` entry removed (legacy 6-agent monolith trace event no longer produced). Two consuming tests (first-decision, reconciliation-correction) migrated to `advisoryNarrative` trap as the closest analog signal.
- **Architecture docs rotated**: SYSTEM-ARCHITECTURE.md §7.1 + §10.1 + §17.1 → "Resolved 2026-04-30". §21 Open Questions #3 + #7 closed. SERVICE-INVENTORY.md advisory-ctrl entry dropped, totals decremented.
- **Stale CLAUDE.md fixed**: `services/advisory/compliance-ctrl/CLAUDE.md` regenerated via audit-service skill — actual subscriptions are `RECOMMENDATION_PROPOSED` + 3 mandate events, not the pre-emptively documented `DECISION_PACKET_*` set.

## Important: RECOMMENDATION_PROPOSED is NOT dead
The initial spec draft mischaracterized RECOMMENDATION_PROPOSED as a legacy 6-agent event and proposed swapping compliance-ctrl onto DECISION_PACKET_CREATED. Verified during plan-writing: RECOMMENDATION_PROPOSED is actively emitted by decision-workflow-ctrl's SF `WaitForCompliance` state (`decision-state-machine.ts:159-177`) carrying the SF taskToken in `subject.taskToken`. compliance-ctrl handler at line 53-55 hard-requires the taskToken and would crash if deprived of it. The spec was amended (commit 60a17680) to "import-path migration" before the plan was written.

## Spec + plan
- Spec: `docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md` (commit f298f55b, amended 60a17680)
- Plan: `docs/superpowers/plans/2026-04-30-advisory-pipeline-consolidation-plan.md`

## Lessons
- "Stale CLAUDE.md generated against a future state that never shipped" is a real failure mode. The compliance-ctrl card was wrong, and the wrong-ness almost made the spec wrong. Verify cards against actual code before trusting them.
- Workstream-style spec sequencing (Spec 1 ships → Spec 2 → Spec 3) lets later specs amend earlier specs cheaply because the architecture doc is the contract, not the spec text.
```

---

### Task 9.3: Update `project_system_architecture_docs.md`

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_system_architecture_docs.md`

- [ ] **Step 1: Append a Spec 2 ship note to the existing topic file**

Add a new section at the end:

```markdown
## Spec 2 SHIPPED 2026-04-30 — advisory pipeline consolidation

- advisory-ctrl deleted entirely (33→32 services).
- AgentCore Memory write/read contract aligned (§17.1 closed).
- Dual DECISION_PACKET_CREATED emitter race resolved (§10.1 closed).
- Open Questions #3 + #7 closed.
- See [project_advisory_pipeline_consolidation.md](./project_advisory_pipeline_consolidation.md).

Spec 3 (onboarding agent reliability) and §21 OQ #11 (locate missing originating specs) remain.
```

---

## Phase 10 — Final verification

### Task 10.1: Confirm success criteria from spec §13

- [ ] **Step 1: Verify each success criterion**

Run each check and confirm the expected output:

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | advisory-ctrl directory absent | `ls services/advisory/advisory-ctrl 2>&1` | "No such file or directory" |
| 2 | Zero `@nestfolio/advisory-ctrl` in non-doc code | `grep -rn "@nestfolio/advisory-ctrl" services/ apps/ libs/ infrastructure/ tools/` | (empty) |
| 3 | Zero `AdvisoryCtrlEventTypes` in non-doc code | `grep -rn "AdvisoryCtrlEventTypes" services/ apps/ libs/ infrastructure/ tools/` | (empty) |
| 4 | `RECOMMENDATION_PROPOSED` in expected places | `grep -rn "RECOMMENDATION_PROPOSED" services/ \| wc -l` | non-zero (decision-workflow-ctrl + compliance-ctrl + tests) |
| 5 | Build/test/lint green | `pnpm nx run-many -t build,test,lint --all --parallel=4` | PASS |
| 7 | §7.1 says Resolved 2026-04-30 | `grep -A2 "^### 7\.1" docs/architecture/SYSTEM-ARCHITECTURE.md` | "Resolved 2026-04-30 (Spec 2)" |
| 7 | §10.1 says Resolved 2026-04-30 | `grep -A2 "^### 10\.1" docs/architecture/SYSTEM-ARCHITECTURE.md` | "Resolved 2026-04-30 (Spec 2)" |
| 7 | §17.1 says Resolved 2026-04-30 | `grep -A2 "^### 17\.1" docs/architecture/SYSTEM-ARCHITECTURE.md` | "Resolved 2026-04-30 (Spec 2)" |
| 8 | OQ #3 + #7 closed | `grep "Closed 2026-04-30 by Spec 2" docs/architecture/SYSTEM-ARCHITECTURE.md \| wc -l` | ≥ 2 |
| 9 | SERVICE-INVENTORY total = 32 | manual read | 32 services, advisory-ctrl absent |
| 10 | MEMORY.md updated | manual read of `MEMORY.md` | "32 services total" present, Spec 2 entry in Recently Completed |
| 11 | One DECISION_PACKET_CREATED per decision | (already verified in Phase 5 Task 5.2) | already done |
| 12 | dev-advisory-ctrl stack gone | (already verified in Phase 6 Task 6.1) | already done |

(Criterion 6 — `pnpm nx run e2e-feature-tests:test-e2e-features` — is run as part of Phase 5 smoke or a follow-up exercise; not gated on this task.)

If all criteria pass, Spec 2 is shipped. Notify the user that Spec 3 (onboarding agent reliability) and §21 OQ #11 (recover missing originating specs) are next in the workstream.

---

## Self-review checklist

(Plan author note — do not include in execution.)

- ✅ Each spec section maps to ≥1 plan task: §3 → Phase 7; §4 → Phase 7 (events deleted with project); §5 → architecture target unchanged; §6.1 → Phase 7 + 8; §6.2 → Phases 1, 3; §6.3 → Phase 2; §6.3.1 → Task 8.6; §6.4 → no action (intentional); §7 → Phase 0; §8 → Phase 0 + 1 + 2 + 3 (test updates); §9 → Phases 5, 6; §10 → Phase 8; §11 → risk noted in confirmation gates; §12 → out-of-scope respected; §13 → Phase 10.
- ✅ All steps contain actual code or actual commands (no "TBD", "implement later", "add appropriate ...").
- ✅ Type/method names consistent across tasks: `BatchCreateMemoryRecordsCommand` / `ListMemoryRecordsCommand` / `RetrieveMemoryRecordsCommand` used consistently; `DecisionWorkflowEventTypes.{DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, USER_CONFIRMATION_REQUESTED, RECOMMENDATION_PROPOSED}` used consistently; `advisoryNarrative` AgentKey used consistently in Phase 3.
- ✅ Phase ordering respects dependencies: consumer migration before deletion; deploy migrated consumers before stack destroy; smoke gate between deploy and destroy.
- ✅ Destructive ops (Phase 5 deploy, Phase 6 destroy) have explicit user-confirmation gates.
- ✅ TDD for Phase 0: red-test-first, then implementation, then green.
