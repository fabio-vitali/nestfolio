# Inter-agent State Handoff — Phase A (latency fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate inter-agent ephemeral output handoff for the 4 advisory agents from AgentCore Memory (eventual-consistency, 28s retry sleep) to Step Functions state (synchronous, deterministic). Daily p95 narrative latency should return from ~56s to <22s within 1 hour of dev deploy.

**Architecture:** Each agent's Lambda handler returns its result inside the `output` field of `resumeStateMachine`'s response; this becomes the SF state value at `$.agentResults.<stateId>`. The state machine's `Parameters` blocks plumb upstream agent outputs into downstream task event subjects. AssemblePacket reads from its event payload directly. Memory infra stays in place for Phase B; only the inter-agent ephemeral path is rewired.

**Tech Stack:** TypeScript / Node 20 / AWS CDK / Step Functions / EventBridge / Lambda / Bedrock AgentCore / Jest / pnpm-nx workspace

**Spec:** `docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md`

**Backlog item:** `docs/backlog/inter-agent-state-handoff-sf-vs-memory.md` (status: active)

**Phase B (long-term Memory strategies) is a SEPARATE plan written after Phase A ships.**

---

## File Structure

**New files:**
- `libs/agent-orchestrator/src/wrap-agent-output.ts` — runtime size guard helper (inline if ≤25 KB, S3 pointer if larger)
- `libs/agent-orchestrator/test/wrap-agent-output.test.ts` — unit tests for the guard
- `apps/e2e-feature-tests/src/advisory/narrative-latency-post-fix.e2e.test.ts` — validation gate test (5 runs, asserts <20s)

**Modified — libs:**
- `libs/agent-orchestrator/src/memory/memory-client.ts` — drop `writeAgentOutput` + `readUpstreamOutput`
- `libs/agent-orchestrator/src/memory/no-op-client.ts` — mirror the drops
- `libs/agent-orchestrator/src/index.ts` — export `wrapAgentOutput`

**Modified — services:**
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — plumb agent outputs through `Parameters`; AssemblePacket invocation includes all 4 agent outputs
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` — read from event payload, delete retry loop + Memory reads
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — drop `memory.grantRead(assemblePacketFn)` (no longer needed)
- `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` — read upstream from event subject, delete retry loop, include result in output
- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` — same shape: subject reads, delete 28s retry loop, include result
- 4× agent service stacks (`advisory-narrative-ctrl`, `portfolio-engine-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`): drop `BatchCreateMemoryRecords` + `ListMemoryRecords` IAM grants
- 4× agent `graph.ts` files: remove `session.writeAgentOutput(...)` calls (writes have no consumer after migration)

**Modified — tests (~8 files):**
- `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts`
- `services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts`
- `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts`
- `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`
- `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` (CDK assertions on new `Parameters`)
- `services/advisory/investor-profile-ctrl/test/unit/graph.test.ts` (remove `mockWriteAgentOutput`)
- `services/advisory/market-intelligence-ctrl/test/unit/graph.test.ts` (same)
- `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` (same)

**Modified — docs:**
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 + §17.1 — reflect that `decisions/{decisionId}` short-term namespace is no longer used by the runtime path

---

## Task 0: Worktree setup

**Files:** none — this is git/branch setup.

- [ ] **Step 1: Create isolated worktree via the using-git-worktrees skill**

Invoke the `superpowers:using-git-worktrees` skill. The skill will create a worktree under `~/.worktrees/nestfolio/` (or a similar path) on a fresh branch named `feat/inter-agent-sf-state-phase-a`.

- [ ] **Step 2: Verify clean state in worktree**

Run from worktree root:
```bash
git status
git log --oneline -5
```
Expected: `working tree clean`; HEAD matches `main` head + new branch checked out.

- [ ] **Step 3: Verify pnpm install completes**

Run from worktree root:
```bash
pnpm install --frozen-lockfile
```
Expected: completes without modifying `pnpm-lock.yaml`. If it modifies the lockfile, abort and investigate (the worktree shouldn't drift from main).

---

## Task 1: Add `wrapAgentOutput` runtime size guard helper

**Files:**
- Create: `libs/agent-orchestrator/src/wrap-agent-output.ts`
- Create: `libs/agent-orchestrator/test/wrap-agent-output.test.ts`
- Modify: `libs/agent-orchestrator/src/index.ts` (add export)

**Why:** SF state per-input limit is 32 KB. Current p99 across 4 agents is 6.1 KB (4× headroom), but agents could grow. Guard wraps output: inline if `<25 KB`, S3 pointer otherwise. Plan-time question Q4 (which S3 bucket): defer the S3 path to a follow-up — Phase A only needs the inline path + the threshold check that throws if exceeded (we'll observe whether it ever fires; per spec risk #4 we don't expect it to in current traffic). If/when it fires, file a follow-up backlog item to wire S3.

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/wrap-agent-output.test.ts`:
```ts
import { wrapAgentOutput, OutputTooLargeError, INLINE_SIZE_THRESHOLD_BYTES } from '../src/wrap-agent-output';

describe('wrapAgentOutput', () => {
  it('returns the output inline when serialized size is below the threshold', () => {
    const output = { decisionId: 'd1', tenantId: 't1', agent: 'narrative', value: 'small' };
    const wrapped = wrapAgentOutput(output);
    expect(wrapped).toEqual({ kind: 'inline', value: output });
  });

  it('returns inline at exactly the threshold boundary', () => {
    // Build an output whose JSON.stringify length is exactly INLINE_SIZE_THRESHOLD_BYTES
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES - JSON.stringify({ p: '' }).length);
    const output = { p: padding };
    expect(JSON.stringify(output).length).toBe(INLINE_SIZE_THRESHOLD_BYTES);
    const wrapped = wrapAgentOutput(output);
    expect(wrapped.kind).toBe('inline');
  });

  it('throws OutputTooLargeError when serialized size exceeds the threshold', () => {
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES + 1);
    const output = { p: padding };
    expect(() => wrapAgentOutput(output)).toThrow(OutputTooLargeError);
    expect(() => wrapAgentOutput(output)).toThrow(/exceeds 25000 bytes/);
  });

  it('reports actual size in the error', () => {
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES + 100);
    const output = { p: padding };
    let caught: OutputTooLargeError | undefined;
    try { wrapAgentOutput(output); } catch (e) { caught = e as OutputTooLargeError; }
    expect(caught).toBeDefined();
    expect(caught!.actualBytes).toBeGreaterThan(INLINE_SIZE_THRESHOLD_BYTES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from worktree root:
```bash
pnpm nx run agent-orchestrator:test --testPathPatterns wrap-agent-output
```
Expected: FAIL with `Cannot find module '../src/wrap-agent-output'`.

- [ ] **Step 3: Implement the helper**

Create `libs/agent-orchestrator/src/wrap-agent-output.ts`:
```ts
/**
 * Runtime size guard for agent outputs flowing through Step Functions state.
 *
 * SF per-input limit is 32 KB; we cap inline at 25 KB to leave 7 KB headroom
 * for surrounding state structure (envelope fields, parallel results, etc.).
 *
 * Phase A: throws OutputTooLargeError if exceeded. Current p99 across 4
 * advisory agents is ~6 KB (4x headroom). If this ever fires in production,
 * file a follow-up to wire an S3-pointer fallback path.
 */
export const INLINE_SIZE_THRESHOLD_BYTES = 25_000;

export class OutputTooLargeError extends Error {
  constructor(public readonly actualBytes: number) {
    super(`Agent output (${actualBytes} bytes) exceeds 25000 bytes inline threshold for SF state`);
    this.name = 'OutputTooLargeError';
  }
}

export type WrappedAgentOutput =
  | { kind: 'inline'; value: Record<string, unknown> };
// future: | { kind: 's3'; bucket: string; key: string };

export function wrapAgentOutput(output: Record<string, unknown>): WrappedAgentOutput {
  const serialized = JSON.stringify(output);
  if (serialized.length > INLINE_SIZE_THRESHOLD_BYTES) {
    throw new OutputTooLargeError(serialized.length);
  }
  return { kind: 'inline', value: output };
}
```

- [ ] **Step 4: Add export to public API**

Modify `libs/agent-orchestrator/src/index.ts` — add at the bottom:
```ts
export { wrapAgentOutput, OutputTooLargeError, INLINE_SIZE_THRESHOLD_BYTES, type WrappedAgentOutput } from './wrap-agent-output';
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm nx run agent-orchestrator:test --testPathPatterns wrap-agent-output
```
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/wrap-agent-output.ts libs/agent-orchestrator/test/wrap-agent-output.test.ts libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): add wrapAgentOutput SF state size guard"
```

---

## Task 2: Update `decision-state-machine.ts` to plumb agent outputs through Parameters

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

**Why:** Today, downstream tasks read upstream outputs from Memory. After Phase A, they read from `$.agentResults.<UpstreamStateId>.agentOutput`. AssemblePacket Lambda receives all 4 agent outputs in its invocation event payload.

- [ ] **Step 1: Read the existing helper to understand the `extraSubject` pattern**

```bash
grep -n "createAgentInvocationState\|extraSubject" services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
```
Expected: see the helper definition (around line 36 per earlier exploration) and existing callers using `extraSubject: { operatingMode: '$.agentResults.InvokeInvestorProfile.operatingMode' }`.

- [ ] **Step 2: Update the failing CDK assertion test first**

Modify `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` — find the test that asserts the AssemblePacket invocation Parameters, or add a new one if none exists. Add this assertion:
```ts
it('plumbs all 4 agent outputs into AssemblePacket invocation Parameters', () => {
  const template = Template.fromStack(stack);
  const stateMachineDef = template.findResources('AWS::StepFunctions::StateMachine');
  const definition = JSON.parse(Object.values(stateMachineDef)[0].Properties.DefinitionString['Fn::Join'][1].join(''));
  const assemblePacketState = definition.States['AssemblePacket'];
  expect(assemblePacketState.Parameters.Payload).toMatchObject({
    'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput',
    'marketAnalysis.$': '$.agentResults.InvokeMarketIntelligence.agentOutput',
    'portfolio.$': '$.agentResults.InvokePortfolioEngine.agentOutput',
    'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',
  });
});

it('plumbs investor-profile agentOutput into PortfolioEngine subject', () => {
  const template = Template.fromStack(stack);
  const stateMachineDef = template.findResources('AWS::StepFunctions::StateMachine');
  const definition = JSON.parse(Object.values(stateMachineDef)[0].Properties.DefinitionString['Fn::Join'][1].join(''));
  const portfolioInvocation = definition.States['InvokePortfolioEngine'];
  const subject = portfolioInvocation.Parameters.Entries[0].Detail.subject;
  expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
});

it('plumbs investor-profile + market-intelligence + portfolio agentOutputs into AdvisoryNarrative subject', () => {
  const template = Template.fromStack(stack);
  const stateMachineDef = template.findResources('AWS::StepFunctions::StateMachine');
  const definition = JSON.parse(Object.values(stateMachineDef)[0].Properties.DefinitionString['Fn::Join'][1].join(''));
  const narrativeInvocation = definition.States['InvokeAdvisoryNarrative'];
  const subject = narrativeInvocation.Parameters.Entries[0].Detail.subject;
  expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
  expect(subject['marketAnalysis.$']).toBe('$.agentResults.InvokeMarketIntelligence.agentOutput');
  expect(subject['portfolio.$']).toBe('$.agentResults.InvokePortfolioEngine.agentOutput');
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm nx run decision-workflow-ctrl:test --testPathPatterns decision-state-machine
```
Expected: FAIL — the new assertions don't match the current state machine definition.

- [ ] **Step 4: Update the state machine definition**

In `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`:

(a) Update `invokePortfolioEngine` — add `investorProfile` to its `extraSubject`:
```ts
const invokePortfolioEngine = createAgentInvocationState(
  'InvokePortfolioEngine',
  'CONSTRUCT_PORTFOLIO',
  {
    extraSubject: {
      operatingMode: '$.agentResults.InvokeInvestorProfile.operatingMode',
      investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
      marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
    },
  },
);
```

(b) Update `invokeAdvisoryNarrative` — add all 3 upstream outputs:
```ts
const invokeAdvisoryNarrative = createAgentInvocationState(
  'InvokeAdvisoryNarrative',
  'GENERATE_NARRATIVE',
  {
    extraSubject: {
      operatingMode: '$.agentResults.InvokeInvestorProfile.operatingMode',
      investorProfile: '$.agentResults.InvokeInvestorProfile.agentOutput',
      marketAnalysis: '$.agentResults.InvokeMarketIntelligence.agentOutput',
      portfolio: '$.agentResults.InvokePortfolioEngine.agentOutput',
    },
  },
);
```

(c) Find the `AssemblePacket` Lambda task state definition (it's the Task state that invokes `assemblePacketFn`). Add the 4 agent outputs to its `Parameters.Payload`:
```ts
// Existing Payload likely has decisionId, tenantId, etc. — ADD these 4:
'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput',
'marketAnalysis.$': '$.agentResults.InvokeMarketIntelligence.agentOutput',
'portfolio.$': '$.agentResults.InvokePortfolioEngine.agentOutput',
'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',
```

(d) Update the inline comment at the top of `invokePortfolioEngine` and `invokeAdvisoryNarrative` (currently mentions "Memory roundtrip avoided for operatingMode") to mention the broader migration:
```ts
// Portfolio + Narrative both need upstream outputs (investor profile, market
// analysis, prior allocations) to drive their reasoning. We pull them from
// `$.agentResults.<Upstream>.agentOutput` (returned by the upstream's
// SendTaskSuccess) so downstream Lambdas read them from their event subject
// directly — no AgentCore Memory roundtrip. This eliminates the >40s
// eventual-consistency window that previously required a 28s retry sleep.
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm nx run decision-workflow-ctrl:test --testPathPatterns decision-state-machine
```
Expected: PASS, all 3 new assertions green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "feat(decision-workflow-ctrl): plumb agent outputs through SF state Parameters"
```

---

## Task 3: Rewrite `assemble-packet.ts` to read from event payload

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`

**Why:** Today AssemblePacket reads 4 outputs from Memory + 28s retry loop on portfolio. After Phase A, all 4 outputs arrive in the event payload (per Task 2's Parameters change). Delete the retry loop, delete the Memory reads, delete the `MemoryClient` dependency. Drop `memory.grantRead(assemblePacketFn)` from the service stack.

- [ ] **Step 1: Update existing tests for new event shape**

Modify `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts` — replace `mockReadUpstream` setup with event-payload fixtures. Find the existing test setup like:
```ts
const mockReadUpstream = jest.fn();
const memoryClient = { openDecisionSession: () => ({ readUpstreamOutput: mockReadUpstream }) };
const handler = createAssemblePacketHandler({ memoryClient, decisionPacketRepository });
```

Replace with:
```ts
const handler = createAssemblePacketHandler({ decisionPacketRepository });
```

For each test, change the event fixture from:
```ts
mockReadUpstream.mockImplementation((svc) => {
  if (svc === 'investor-profile') return Promise.resolve([{ content: JSON.stringify({...}) }]);
  // ...
});
const result = await handler({ decisionId: 'd1', tenantId: 't1', /* other env fields */ });
```

To:
```ts
const result = await handler({
  decisionId: 'd1', tenantId: 't1', userId: 'u1', region: 'us-east-1',
  trigger: 'INVESTOR_PROFILE_CREATED', triggerEventId: 'e1', executionArn: null,
  investorProfile: { /* the existing content object */ },
  marketAnalysis: { /* the existing content object */ },
  portfolio: { 'portfolio-construction': { allocations: [...] } },
  narrative: { explainability: { rationale: '...' } },
});
```

Add a new test for the missing-upstream defence-in-depth path:
```ts
it('falls back to placeholder when an upstream agent output is null', async () => {
  const result = await handler({
    decisionId: 'd1', tenantId: 't1', userId: 'u1', region: 'us-east-1',
    trigger: 'INVESTOR_PROFILE_CREATED', triggerEventId: 'e1', executionArn: null,
    investorProfile: null,
    marketAnalysis: null,
    portfolio: null,
    narrative: null,
  });
  expect(result.proposedTrades).toEqual([]);
  expect(result.explanation).toMatch(/Decision pending/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run decision-workflow-ctrl:test --testPathPatterns assemble-packet
```
Expected: FAIL — handler still reads from `memoryClient`, not from event.

- [ ] **Step 3: Rewrite the handler**

Replace the entire content of `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` with:
```ts
import { requireEnv } from '@nestfolio/event-processor';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';

interface AssemblePacketDeps {
  decisionPacketRepository: DecisionPacketRepository;
}

interface AssemblePacketEvent {
  decisionId: string;
  tenantId: string;
  userId: string;
  region: string;
  trigger: string;
  triggerEventId: string;
  executionArn: string | null;
  // Agent outputs plumbed via SF state Parameters from $.agentResults.<Upstream>.agentOutput.
  // Any may be null/undefined when the upstream agent failed to produce structured output —
  // the placeholder fallback below keeps the decision packet creatable in degraded states.
  investorProfile?: Record<string, unknown> | null;
  marketAnalysis?: Record<string, unknown> | null;
  portfolio?: Record<string, unknown> | null;
  narrative?: Record<string, unknown> | null;
}

export function createAssemblePacketHandler(deps: AssemblePacketDeps) {
  return async (event: AssemblePacketEvent): Promise<Record<string, unknown>> => {
    const {
      decisionId, tenantId, userId, region, trigger, triggerEventId, executionArn,
      investorProfile = null, marketAnalysis = null, portfolio = null, narrative = null,
    } = event;

    // Single-writer SF-state contract (post-Phase-A 2026-05-14): agent outputs
    // arrive via SF state Parameters from $.agentResults.<Upstream>.agentOutput.
    // No Memory reads, no retry loop, no eventual-consistency window. The
    // placeholder fallbacks below are defence-in-depth for cases where an
    // upstream agent failed to produce structured output (DegradedAgentOutputError
    // path) — they keep the decision packet creatable in degraded states.

    // Portfolio output schema: AgentRuntime returns
    // {portfolio-construction:{allocations,...}, rebalance-planner:{trades,...}}
    // — see services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts.
    const construction = (portfolio?.['portfolio-construction'] as Record<string, unknown> | undefined) ?? {};
    const allocations = (construction.allocations as Array<Record<string, unknown>> | undefined) ?? [];

    // Map allocations → ProposedTrade shape per advisory-bff schema
    // (services/advisory/advisory-bff/src/schema.graphql:84). Phase 2 of the
    // operating-mode workstream made `assetClass` mandatory.
    const proposedTrades = allocations.map((a) => ({
      symbol: a.instrument,
      assetClass: a.assetClass,
      targetWeightPercent: typeof a.targetWeight === 'number' ? a.targetWeight * 100 : 0,
      rationale: a.rationale,
    }));

    // Narrative output schema: agent's writeAgentOutput previously persisted
    // {explainability: shaped['explainability'].output} — the same shape now
    // arrives directly through SF state. See narrative graph.ts:132.
    const explainability = (narrative?.explainability as Record<string, unknown> | undefined) ?? {};
    const explanation =
      (explainability.rationale as string | undefined) ??
      (explainability.summary as string | undefined) ??
      `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;

    // Risk + position derivations (unchanged from previous Memory-based version)
    const totalExposure = (construction.totalExposure as number | undefined) ?? 0;
    const equityWeight = (construction.equityWeight as number | undefined) ?? 0;
    const riskMetrics = (construction.riskMetrics as Record<string, number> | undefined) ?? {};
    const portfolioValue = totalExposure;
    const riskScore = (riskMetrics.concentrationRisk as number | undefined) ?? 0;
    const currentPositions: unknown[] = [];

    // Materialize the DecisionPacket row. CDC on this INSERT emits
    // DECISION_PACKET_CREATED on advisoryBus, which the dashboard read model
    // and advisory-bff DecisionReadModel both subscribe to. Idempotent under
    // SF retries (putIfNotExists).
    await deps.decisionPacketRepository.createDecisionPacket(
      { decisionId, tenantId, userId, region, trigger, triggerEventId, executionArn,
        explanation, proposedTrades, currentPositions, portfolioValue, riskScore, equityWeight },
    );

    return {
      decisionId, tenantId,
      investorProfileOutput: investorProfile,
      marketAnalysisOutput: marketAnalysis,
      portfolioOutput: portfolio,
      narrativeOutput: narrative,
      proposedTrades, currentPositions, portfolioValue, riskScore,
    };
  };
}

// Production wiring
const tableName = requireEnv('TABLE_NAME');
const decisionPacketRepository = new DecisionPacketRepository(tableName);
export const handler = createAssemblePacketHandler({ decisionPacketRepository });
```

- [ ] **Step 4: Drop `memory.grantRead(assemblePacketFn)` from the service stack**

In `services/advisory/decision-workflow-ctrl/src/service.stack.ts`, find the line:
```ts
memory.grantRead(assemblePacketFn);
```
Delete it. Also remove the `MEMORY_ID` env var from the `assemblePacketFn` `environment` block (the handler no longer uses it):
```ts
// BEFORE
environment: {
  MEMORY_ID: memory.memoryId,
  TABLE_NAME: state.getTable().tableName,
},

// AFTER
environment: {
  TABLE_NAME: state.getTable().tableName,
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm nx run decision-workflow-ctrl:test --testPathPatterns assemble-packet
```
Expected: PASS — all assemble-packet tests green including the new fallback test.

- [ ] **Step 6: Run the full decision-workflow-ctrl test suite**

```bash
pnpm nx run decision-workflow-ctrl:test
```
Expected: PASS — including the state-machine assertions from Task 2.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "feat(decision-workflow-ctrl): assemble-packet reads from SF state, drops Memory deps"
```

---

## Task 4: Rewrite `narrative event-listener.ts` — subject reads, delete retry loop, return result in output

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts`

**Why:** This is the central fix. Delete the 28s retry sleep loop. Read upstream outputs from event subject (Task 2 plumbed them in). Return the agent result inside the SF output so downstream consumers (just AssemblePacket here, since narrative is the last agent) get it. Keep the 2 `searchLongTermMemory` calls — they return `[]` today and Phase B fills them.

- [ ] **Step 1: Update existing tests for new event shape**

Modify `services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts`. Find the existing tests that mock `readUpstreamOutput`. Replace them with subject-based fixtures.

Find the existing setup, looking like:
```ts
const mockReadUpstreamOutput = jest.fn();
const mockSearchLongTerm = jest.fn().mockResolvedValue([]);
const memoryClient = { openDecisionSession: () => ({ readUpstreamOutput: mockReadUpstreamOutput, searchLongTermMemory: mockSearchLongTerm, writeAgentOutput: jest.fn() }) };
```

Replace with (Memory client now ONLY needs `searchLongTermMemory` + `openDecisionSession`):
```ts
const mockSearchLongTerm = jest.fn().mockResolvedValue([]);
const memoryClient = { openDecisionSession: () => ({ searchLongTermMemory: mockSearchLongTerm }), searchTenantMemory: jest.fn() };
```

For each test, build the event payload with `subject.{investorProfile, marketAnalysis, portfolio}` populated:
```ts
const event = {
  type: 'GENERATE_NARRATIVE',
  subject: {
    decisionId: 'd1', tenantId: 't1', taskToken: 'tt1',
    operatingMode: 'BALANCED',
    investorProfile: { riskScore: 0.5, /* ... */ },
    marketAnalysis: { sectors: [/* ... */] },
    portfolio: { 'portfolio-construction': { allocations: [/* ... */] } },
  },
};
```

Delete any test that asserts retry-loop behavior on `MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE` — the retry loop is gone.

Add a new test asserting the output includes the agent result:
```ts
it('returns the agent result inside SF output for downstream consumers', async () => {
  const fakeAgentResult = { explainability: { rationale: 'because...', summary: 'short' } };
  mockAgentService.runPipeline.mockResolvedValue(fakeAgentResult);

  const handlers = createHandlers({ agentService: mockAgentService, feedbackCorrelator: mockFeedback, memoryClient });
  const handlerResult = await handlers.GENERATE_NARRATIVE(event.subject ? { subject: event.subject } : event, ctx);

  expect(handlerResult.output).toMatchObject({
    decisionId: 'd1', tenantId: 't1',
    agentOutput: fakeAgentResult,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run advisory-narrative-ctrl:test --testPathPatterns event-listener
```
Expected: FAIL — handler still calls `readUpstreamOutput`, doesn't return `agentOutput`.

- [ ] **Step 3: Rewrite the GENERATE_NARRATIVE handler**

In `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`, find the `GENERATE_NARRATIVE` handler. Replace the body (the part that calls `session.readUpstreamOutput` and runs the retry loop) so it:

(a) Reads upstream outputs from `subject.{investorProfile, marketAnalysis, portfolio}` instead of Memory.
(b) Keeps the 2 `searchLongTermMemory` calls (preferences, sessionHistory).
(c) Deletes the entire retry loop (lines 55-63).
(d) Includes `agentOutput: result` in the returned `output` object.

Replace lines from `const session = deps.memoryClient.openDecisionSession(...)` through the end of the `GENERATE_NARRATIVE` handler body with:
```ts
    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    // Long-term recall reads (preferences + session history). These return []
    // today and will be populated by Phase B (long-term Memory strategies).
    // See docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md
    // Part B.
    const [preferences, sessionHistory] = await Promise.all([
      session.searchLongTermMemory('narrative preferences communication style'),
      session.searchLongTermMemory('session summaries'),
    ]);

    // Inter-agent ephemeral handoff: upstream outputs arrive via SF state
    // Parameters from $.agentResults.<Upstream>.agentOutput. No Memory reads,
    // no eventual-consistency wait. Empty/null upstreams are tolerated; the
    // agent input simply has empty objects in those slots (matches the
    // pre-migration Memory-empty behavior). See spec Part A.
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
        preferences: preferences.map(r => r.content),
        sessionHistory: sessionHistory.map(r => r.content),
      });
    } catch (error) {
      if (error instanceof DuplicateInvocationError) {
        logger.info('Duplicate GENERATE_NARRATIVE event, skipping', { eventId: ctx.eventId, decisionId });
        return { output: { decisionId, tenantId, deduplicated: true } };
      }
      throw error;
    }

    // Wrap result for SF state with size guard (currently inline-only;
    // throws OutputTooLargeError if >25 KB — file follow-up if observed).
    const wrapped = wrapAgentOutput(result);

    return {
      output: { decisionId, tenantId, agentOutput: wrapped.value },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'advisory-narrative' })],
    };
```

Add the import at the top of the file:
```ts
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError, wrapAgentOutput } from '@nestfolio/agent-orchestrator';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm nx run advisory-narrative-ctrl:test --testPathPatterns event-listener
```
Expected: PASS, including the new agentOutput assertion.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts services/advisory/advisory-narrative-ctrl/test/unit/event-listener.test.ts
git commit -m "feat(advisory-narrative-ctrl): subject-based upstream reads, delete 28s retry loop"
```

---

## Task 5: Rewrite `portfolio-engine event-listener.ts` — same shape

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts`

**Why:** Same migration as Task 4 but for portfolio-engine. Reads `investorProfile` + `marketAnalysis` from subject; keeps `searchLongTermMemory('allocation rationale decisions')`; includes result in output for downstream narrative + AssemblePacket.

- [ ] **Step 1: Update existing tests**

Modify `services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts`. Apply the same transformation as Task 4 step 1:
- Drop `mockReadUpstreamOutput` setup
- Add subject-based fixtures with `investorProfile` + `marketAnalysis`
- DELETE the test at line ~180 named `'retries readUpstreamOutput("investor-profile") when first read is empty and proceeds when retry returns content'` — the retry behavior is gone
- Add a new test asserting `output.agentOutput` equals the agent result

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPatterns event-listener
```
Expected: FAIL.

- [ ] **Step 3: Rewrite the CONSTRUCT_PORTFOLIO handler**

In `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`, replace the body of CONSTRUCT_PORTFOLIO (the part with the `Promise.all([readUpstreamOutput(...), ...])` and the retry loop) with:
```ts
      const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

      // Long-term recall (returns [] today; Phase B populates).
      const pastRationale = await session.searchLongTermMemory('allocation rationale decisions');

      // Inter-agent ephemeral handoff via SF state. See spec Part A.
      const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
      const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};

      let result: Record<string, unknown>;
      try {
        result = await deps.agentService.runPipeline(ctx.eventId, {
          tenantId, decisionId, operatingMode,
          investorProfile, marketAnalysis,
          pastRationale: pastRationale.map(r => r.content),
        });
      } catch (error) {
        if (error instanceof DuplicateInvocationError) {
          logger.info('Duplicate CONSTRUCT_PORTFOLIO event, skipping', { eventId: ctx.eventId, decisionId });
          return { output: { decisionId, tenantId, deduplicated: true } };
        }
        throw error;
      }

      const wrapped = wrapAgentOutput(result);

      return {
        output: { decisionId, tenantId, agentOutput: wrapped.value },
        intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'portfolio-engine' })],
      };
```

Add the import at the top:
```ts
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError, wrapAgentOutput } from '@nestfolio/agent-orchestrator';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm nx run portfolio-engine-ctrl:test --testPathPatterns event-listener
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts services/advisory/portfolio-engine-ctrl/test/unit/event-listener.test.ts
git commit -m "feat(portfolio-engine-ctrl): subject-based upstream reads, delete retry loop"
```

---

## Task 6: Update `investor-profile-ctrl` and `market-intelligence-ctrl` to include result in output

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts`

**Why:** These two are the heads of the parallel branch — they have no upstream agents to read from, but they DO need to include their result in `output.agentOutput` so downstream agents (portfolio, narrative) and AssemblePacket can read them via SF state.

- [ ] **Step 1: Update tests for both services**

For each of the two `event-listener.test.ts` files, find the test asserting the SF output shape (currently `{ decisionId, tenantId, operatingMode? }`) and add `agentOutput: <expectedResult>`.

Add a new test like:
```ts
it('returns the agent result inside SF output for downstream consumers', async () => {
  const fakeResult = { /* shape per agent */ };
  mockAgentService.runPipeline.mockResolvedValue(fakeResult);
  const handlers = createHandlers({ agentService: mockAgentService, memoryClient });
  const handlerResult = await handlers.ANALYZE_INVESTOR_PROFILE(/* or ANALYZE_MARKET */ event, ctx);
  expect(handlerResult.output.agentOutput).toEqual(fakeResult);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,market-intelligence-ctrl --testPathPatterns event-listener
```
Expected: FAIL.

- [ ] **Step 3: Update both handlers**

For `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`, find the `ANALYZE_INVESTOR_PROFILE` handler. After the existing `result = await deps.agentService.runPipeline(...)` block, change the `return` to:
```ts
const wrapped = wrapAgentOutput(result);
return {
  output: {
    decisionId,
    tenantId,
    operatingMode: /* existing operatingMode value */,
    agentOutput: wrapped.value,
  },
  intents: [/* existing intents */],
};
```

Add import:
```ts
import { /* existing */, wrapAgentOutput } from '@nestfolio/agent-orchestrator';
```

Same change for `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` `ANALYZE_MARKET` handler — but no `operatingMode` field in its output (only investor-profile carries that):
```ts
const wrapped = wrapAgentOutput(result);
return {
  output: { decisionId, tenantId, agentOutput: wrapped.value },
  intents: [/* existing intents */],
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,market-intelligence-ctrl --testPathPatterns event-listener
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts
git commit -m "feat(advisory): investor-profile + market-intelligence include result in SF output"
```

---

## Task 7: Remove `writeAgentOutput` calls from 4 agent `graph.ts` files

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`
- Modify: each agent's `graph.test.ts`

**Why:** These calls write agent output to AgentCore Memory at `/{service}/{tenantId}/decisions/{decisionId}`. After Phase A there's no consumer for those records (the readers were deleted in Tasks 3-5). Deleting the writes prevents wasted AgentCore Memory cost + removes dead code.

The writes look like `await session.writeAgentOutput(<some-shape>)`. They're in each agent graph's main result-handling path, after `invokeOrchestrator` returns.

- [ ] **Step 1: Find each call site**

Run:
```bash
grep -rn "session.writeAgentOutput\|writeAgentOutput(" services/advisory/*/agents/ --include='*.ts'
```
Expected: 4 call sites in `*/graph.ts`, plus mocks/asserts in `*/graph.test.ts`.

- [ ] **Step 2: Update each `graph.test.ts` to drop the writeAgentOutput assertion**

For each of the 4 `graph.test.ts` files, find tests like:
```ts
expect(session.writeAgentOutput).toHaveBeenCalledWith(expectedShape);
```
Delete those assertions. Also delete the mock setup of `writeAgentOutput` in the session mock — change:
```ts
const session = { writeAgentOutput: jest.fn(), readUpstreamOutput: jest.fn(), searchLongTermMemory: jest.fn().mockResolvedValue([]) };
```
to:
```ts
const session = { searchLongTermMemory: jest.fn().mockResolvedValue([]) };
```

- [ ] **Step 3: Run tests to verify the existing assertions fail**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl --testPathPatterns graph
```
Expected: FAIL — graph.ts still calls writeAgentOutput; tests no longer mock it.

Wait — actually the tests removed the assertion. So they should pass even with writeAgentOutput still called (just not asserted). Skip this step's "fail" expectation; if tests pass, proceed to Step 4 directly to delete the source calls.

- [ ] **Step 4: Delete the `writeAgentOutput` call in each graph.ts**

For each graph.ts, find the line(s) like:
```ts
await session.writeAgentOutput(<shape>);
```
Delete that line. Also delete the surrounding multi-line comment that explains why the write happens (the comment becomes obsolete). For example, in `advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:132`:
```ts
// BEFORE
// Persist to memory — Phase β (Spec 4, 2026-05-06): only write when every
// agent's wave-node entry is `ok: true`. Strip the discriminant before
// writing; Memory consumers expect raw outputs.
await session.writeAgentOutput({ explainability: shaped['explainability'].output });

// AFTER (delete both the comment and the call entirely)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm nx run-many --target=test --projects=investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl --testPathPatterns graph
```
Expected: PASS — all graph tests still green.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/*/agents/*/graph.ts services/advisory/*/agents/*/graph.test.ts
git commit -m "refactor(advisory): remove dead writeAgentOutput calls in 4 agent graphs"
```

---

## Task 8: Drop `MemoryClient.writeAgentOutput` + `readUpstreamOutput` from the lib

**Files:**
- Modify: `libs/agent-orchestrator/src/memory/memory-client.ts`
- Modify: `libs/agent-orchestrator/src/memory/no-op-client.ts`
- Modify: `libs/agent-orchestrator/test/memory-client.test.ts` (if it exists; else skip)

**Why:** After Tasks 3-7, no caller invokes these methods. Drop them from the interface + the two implementations to remove dead surface area + drop the IAM grants in Task 9.

- [ ] **Step 1: Verify no callers remain**

```bash
grep -rn "writeAgentOutput\|readUpstreamOutput" services/ libs/ --include='*.ts' | grep -v 'memory-client.ts\|no-op-client.ts\|.test.ts'
```
Expected: empty output (no callers in source). If any remain, fix them before proceeding.

- [ ] **Step 2: Drop the methods from the `DecisionSession` interface**

In `libs/agent-orchestrator/src/memory/memory-client.ts`, find the `DecisionSession` interface (around line 21). Delete these 2 lines:
```ts
writeAgentOutput(output: Record<string, unknown>): Promise<void>;
readUpstreamOutput(upstreamService: string): Promise<MemoryRecord[]>;
```

Also delete their implementations in the `openDecisionSession` factory (around lines 37-70) — find the methods named `writeAgentOutput` and `readUpstreamOutput` and delete them entirely (each is ~10 lines including the `BatchCreateMemoryRecordsCommand` / `ListMemoryRecordsCommand` blocks).

If after deletion the imports `BatchCreateMemoryRecordsCommand` and `ListMemoryRecordsCommand` are unused, delete them from the top-of-file import block.

- [ ] **Step 3: Drop the methods from the no-op client**

In `libs/agent-orchestrator/src/memory/no-op-client.ts`, in the `noOpSession` object, delete the `writeAgentOutput` and `readUpstreamOutput` methods. The remaining session should have only `searchLongTermMemory`.

- [ ] **Step 4: Run the full agent-orchestrator test suite**

```bash
pnpm nx run agent-orchestrator:test
```
Expected: PASS — including the wrap-agent-output test from Task 1.

- [ ] **Step 5: Build the lib + dependent services to catch any TypeScript errors**

```bash
pnpm nx run-many --target=build --projects=agent-orchestrator,advisory-narrative-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,market-intelligence-ctrl,decision-workflow-ctrl
```
Expected: all builds green. If any compile error references `writeAgentOutput` or `readUpstreamOutput`, that means a caller was missed in earlier tasks — fix it.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/memory/memory-client.ts libs/agent-orchestrator/src/memory/no-op-client.ts
git commit -m "refactor(agent-orchestrator): drop writeAgentOutput + readUpstreamOutput from MemoryClient"
```

---

## Task 9: Drop `BatchCreateMemoryRecords` + `ListMemoryRecords` IAM grants from 4 service stacks

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: each service stack's CDK assertion test

**Why:** Code no longer calls these APIs. Removing the grants reduces the IAM blast radius of each agent runtime. KEEP the `RetrieveMemoryRecords` grant (the `searchLongTermMemory` callers still use it for Phase B).

- [ ] **Step 1: For each of the 4 stacks, find the IAM action lists**

```bash
grep -n "BatchCreateMemoryRecords\|ListMemoryRecords\|RetrieveMemoryRecords" services/advisory/*/src/service.stack.ts
```
Expected: see each stack listing both the agent-runtime grant block (around line 77-114 in narrative-ctrl) and a second block (Lambda handler grant, lines 111-135 etc).

- [ ] **Step 2: Delete the 2 actions from each PolicyStatement**

For each stack, find each `actions: [...]` array containing `'bedrock-agentcore:BatchCreateMemoryRecords'` and `'bedrock-agentcore:ListMemoryRecords'`. Delete those 2 lines from each list. Keep `'bedrock-agentcore:RetrieveMemoryRecords'` if present (else add it — needed for Phase B's `searchLongTermMemory`).

Example for `advisory-narrative-ctrl/src/service.stack.ts:75-82`:
```ts
// BEFORE
actions: [
  'bedrock-agentcore:RetrieveMemoryRecords',
  'bedrock-agentcore:BatchCreateMemoryRecords',
  'bedrock-agentcore:GetMemoryRecord',
  'bedrock-agentcore:ListMemoryRecords',
  'bedrock-agentcore:ListEvents',
  // ...
],

// AFTER
actions: [
  'bedrock-agentcore:RetrieveMemoryRecords',
  'bedrock-agentcore:GetMemoryRecord',
  'bedrock-agentcore:ListEvents',
  // ...
],
```

- [ ] **Step 3: Update CDK assertion tests**

For each service stack test (e.g., `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`), find any assertion mentioning `BatchCreateMemoryRecords` or `ListMemoryRecords`. Delete those assertions. Add (or update) an assertion confirming `RetrieveMemoryRecords` is granted:
```ts
it('grants RetrieveMemoryRecords on AgentCore Memory (no longer grants Batch/List for inter-agent handoff)', () => {
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['bedrock-agentcore:RetrieveMemoryRecords']),
        }),
      ]),
    },
  });
  // Negative assertion: BatchCreateMemoryRecords + ListMemoryRecords no longer present
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const json = JSON.stringify(policy);
    expect(json).not.toContain('BatchCreateMemoryRecords');
    expect(json).not.toContain('ListMemoryRecords');
  }
});
```

- [ ] **Step 4: Run all 4 service stack tests**

```bash
pnpm nx run-many --target=test --projects=advisory-narrative-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,market-intelligence-ctrl --testPathPatterns service.stack
```
Expected: PASS for all 4.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/*/src/service.stack.ts services/advisory/*/test/unit/service.stack.test.ts
git commit -m "refactor(advisory): drop BatchCreateMemoryRecords + ListMemoryRecords IAM grants"
```

---

## Task 10: Update `SYSTEM-ARCHITECTURE.md` §17 + §17.1

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

**Why:** §17 currently describes `decisions/{decisionId}` short-term namespace as the canonical inter-agent handoff. After Phase A this is no longer true. §17.1 ("Architectural Evolution") needs an update describing the SF-state-based model.

- [ ] **Step 1: Read the current §17 + §17.1 to understand exact wording**

```bash
sed -n '380,440p' docs/architecture/SYSTEM-ARCHITECTURE.md
```

- [ ] **Step 2: Update §17 namespace table**

In `docs/architecture/SYSTEM-ARCHITECTURE.md`, find the namespace table under §17. Change the `decisions/{decisionId}` row to read:
```
| `decisions/{decisionId}` | (deprecated 2026-05-14, see §17.1) | Previously per-decision agent inputs/outputs; replaced by Step Functions state-based handoff |
```

(Keep the long-term namespace rows — `preferences`, `signals`, `rationale`, `sessions/{sessionId}` — unchanged. Phase B will populate them.)

- [ ] **Step 3: Add a new §17.2 entry below §17.1**

After §17.1, append:
```markdown
### 17.2 Architectural Evolution — Inter-agent handoff moved to Step Functions state

**Resolved 2026-05-14 (Phase A of `inter-agent-state-handoff-sf-vs-memory`).** AgentCore Memory's >40s `ListMemoryRecords` eventual-consistency window made the decision-scoped namespace unsuitable for synchronous inter-agent ephemeral handoff. A 28s retry sleep loop in `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` mitigated the worst case but caused a 3x latency regression (p50 13s → 49s) since 2026-05-09.

**New model:**
- Each agent's Lambda handler returns the agent result inside `output.agentOutput`. `resumeStateMachine` calls `SendTaskSuccessCommand` with this payload. SF captures it at `$.agentResults.<UpstreamStateId>.agentOutput`.
- Downstream tasks plumb upstream outputs through `Parameters` blocks: `'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput'`. Each downstream agent reads its upstream context from its event subject — no Memory call.
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` reads all 4 agent outputs from its event payload directly.
- Runtime size guard at `libs/agent-orchestrator/src/wrap-agent-output.ts`: throws `OutputTooLargeError` if a single agent output exceeds 25 KB (4x current p99 headroom). If observed in production, a follow-up wires an S3-pointer fallback.

The `MemoryClient.writeAgentOutput` and `readUpstreamOutput` methods are removed; the corresponding `BatchCreateMemoryRecords` and `ListMemoryRecords` IAM grants are dropped from the 4 advisory agent service stacks. The `agentcore.Memory` construct itself remains — long-term recall (the `searchLongTermMemory` and `searchTenantMemory` callers) still depends on it. Phase B (`inter-agent-state-handoff-sf-vs-memory` workstream, separate plan) wires Bedrock MemoryStrategies on the `preferences`, `signals`, and `rationale` long-term namespaces.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(architecture): SYSTEM-ARCHITECTURE §17 reflects SF-state inter-agent handoff"
```

---

## Task 11: Run integration suite locally

**Files:** none — test execution.

**Why:** Catch any cross-cutting breakage (e.g., agent-orchestrator changes affecting agent-runtime startup) before deploying to dev.

- [ ] **Step 1: Run integration tests for the 5 affected services + agent-orchestrator**

```bash
pnpm nx run-many --target=test-integration --projects=advisory-narrative-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,market-intelligence-ctrl,decision-workflow-ctrl --parallel=8
```
Expected: PASS for all 5 services. Some tests use real Memory via `@nestfolio/test-support` — verify they still pass without the writeAgentOutput/readUpstreamOutput round-trip (the integration tests should be exercising end-to-end behavior, which now flows through SF state).

If any test fails referencing `readUpstreamOutput` or `writeAgentOutput`, those tests need fixture updates similar to Task 4-7's unit test transformations. Address inline.

- [ ] **Step 2: Run the full unit test suite for the workspace**

```bash
pnpm nx run-many --target=test --all --parallel=8
```
Expected: ALL workspace tests green. If any unrelated service test fails, investigate (may indicate a transitive broken type).

- [ ] **Step 3: Build all CDK stacks**

```bash
pnpm nx run-many --target=build --all --parallel=8
```
Expected: clean.

- [ ] **Step 4: No commit** — this task is verification only.

---

## Task 12: Deploy to dev sandbox

**Files:** none — deploy execution.

**Why:** Phase A ships as a single dev deploy (atomic cutover per spec).

- [ ] **Step 1: Deploy the 5 affected services**

Run from the worktree root:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,market-intelligence-ctrl 2>&1 | tee /tmp/phase-a-deploy.log
```
Expected: deploy completes without CFN errors. The 4 agent service stacks will rebuild their AgentRuntime Docker images (the agent-orchestrator lib changed). Total time: 5-15 minutes.

- [ ] **Step 2: Verify CloudFormation stack updates succeeded**

```bash
AWS_PROFILE=nestfolio-dev aws cloudformation describe-stacks --region us-east-1 --query 'Stacks[?starts_with(StackName,`Dev`)].[StackName,StackStatus]' --output table
```
Expected: All 5 advisory ctrl stacks in `UPDATE_COMPLETE`.

- [ ] **Step 3: No commit** — this task is deploy only.

---

## Task 13: Run e2e validation gate against deployed dev

**Files:** none — e2e execution + manual CloudWatch verification.

**Why:** Confirm the latency regression has actually closed. Spec validation gate: 5 consecutive runs of `first-decision.e2e.test.ts` + `reconciliation-correction.e2e.test.ts` pass with `gen_ai.invocation.latency_ms < 20_000`; CloudWatch p95 returns to <22s within 1 hour.

- [ ] **Step 1: Run the two narrative-latency-asserting e2e files 5 times each**

Run from the worktree root:
```bash
for i in 1 2 3 4 5; do
  echo "=== Run $i ==="
  NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns 'first-decision.e2e.test.ts|reconciliation-correction.e2e.test.ts' 2>&1 | tail -30
done
```
Expected: 5 consecutive passes, all assertions including `gen_ai.invocation.latency_ms < 20_000` green.

If any run fails on the latency assertion: the deploy didn't close the regression. Check CloudWatch (next step) before iterating.

- [ ] **Step 2: Verify CloudWatch p95 returned to <22s**

Wait at least 30 minutes after deploy + first e2e run. Then:
```bash
AWS_PROFILE=nestfolio-dev aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=$(aws lambda list-functions --query 'Functions[?contains(FunctionName,`dev-advisory-narrative-ctrl-IngressHandler`)].FunctionName' --output text) \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 --extended-statistics p50 p95 \
  --region us-east-1 --query 'Datapoints[0].ExtendedStatistics' --output table
```
Expected: p95 < 22000 (ms). If p95 still >25s, something is wrong — investigate CloudWatch Logs for the new code path before claiming Phase A success.

- [ ] **Step 3: No commit** — this task is verification only.

---

## Task 14: Ship the blocker dossier + Phase A workstream marker

**Files:**
- Modify: `docs/backlog/advisory-narrative-latency-budget-overshoot-e2e.md`
- Modify: `docs/backlog/inter-agent-state-handoff-sf-vs-memory.md`

**Why:** Phase A's validation gate has passed. The blocker dossier ships. The parent workstream stays `active` (Phase B is still pending), with a note documenting Phase A shipped.

- [ ] **Step 1: Mark `advisory-narrative-latency-budget-overshoot-e2e` as shipped**

Edit `docs/backlog/advisory-narrative-latency-budget-overshoot-e2e.md` frontmatter:
```yaml
status: shipped
validation_gate: "SHIPPED 2026-05-14 — 5/5 e2e runs of first-decision + reconciliation-correction green with gen_ai.invocation.latency_ms < 20_000. CloudWatch dev narrative-ingress Lambda Duration p95 returned from ~56s to <22s within 1 hour of deploy. Root cause (28s Memory retry loop) deleted; replaced by SF-state inter-agent handoff per docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md Phase A."
```

- [ ] **Step 2: Update the parent workstream's note + topic_memory**

Edit `docs/backlog/inter-agent-state-handoff-sf-vs-memory.md` frontmatter `notes:` field to mark Phase A shipped, leaving Phase B pending. Also create + link a topic memory dossier — but that requires running the topic-memory creation workflow, which is out of scope for this plan. Instead, add a body section noting Phase A status:

Append to the body of the file:
```markdown

## Phase A — SHIPPED 2026-05-14

Phase A of this workstream shipped as commit-batch on `feat/inter-agent-sf-state-phase-a` branch (see git log). Validation gate met: CloudWatch p95 narrative latency returned to <22s, e2e suites green 5/5.

**Phase B (long-term Memory strategies) remains.** Planned via separate spec/plan after Phase A's behavior is observed in dev for 3-7 days. Workstream stays `active`.
```

- [ ] **Step 3: Run backlog-lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```
Expected: `✓ N backlog files; all 8 rules pass (with --fix applied)`.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog/advisory-narrative-latency-budget-overshoot-e2e.md docs/backlog/inter-agent-state-handoff-sf-vs-memory.md docs/BACKLOG.md
git commit -m "docs(backlog): ship advisory-narrative-latency-budget-overshoot-e2e (Phase A done)"
```

- [ ] **Step 5: Push the branch + open PR**

```bash
git push -u origin feat/inter-agent-sf-state-phase-a
gh pr create --title "feat(advisory): inter-agent state handoff via SF state (Phase A)" --body "$(cat <<'EOF'
## Summary

- Migrate inter-agent ephemeral output handoff for the 4 advisory agents from AgentCore Memory (eventual-consistency, 28s retry sleep) to Step Functions state (synchronous, deterministic).
- Daily p95 narrative latency returns from ~56s (post-2026-05-09 regression) to <22s (pre-regression baseline). Validates spec § Goal A.
- Memory infra + the 6 \`searchLongTermMemory\` callers remain intact for Phase B.

## Spec
- Design: \`docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md\` (commit \`6f3e67cf\`)
- Plan: \`docs/superpowers/plans/2026-05-14-inter-agent-state-handoff-phase-a.md\`

## Test plan

- [x] Unit suite green (all 4 advisory ctrl services + decision-workflow-ctrl + agent-orchestrator)
- [x] Integration suite green (5 services, --parallel=8)
- [x] CDK stacks build clean
- [x] Dev deploy of 5 services completes successfully (UPDATE_COMPLETE on all 5 CFN stacks)
- [x] 5/5 consecutive e2e runs of \`first-decision.e2e.test.ts\` + \`reconciliation-correction.e2e.test.ts\` pass with \`gen_ai.invocation.latency_ms < 20_000\`
- [x] CloudWatch dev narrative-ingress Lambda Duration p95 returns to <22s within 1 hour of deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Plan tasks |
|---|---|
| Goal A (latency fix) | Tasks 1-13 (all of Phase A) |
| Goal B (long-term recall) | Out of scope per plan header — separate plan after Phase A ships |
| Part A: SF state migration components | Tasks 2 (state machine), 3 (assemble-packet), 4 (narrative), 5 (portfolio), 6 (investor + market), 7 (graph.ts cleanup), 8 (MemoryClient slim), 9 (IAM) |
| Runtime size guard | Task 1 |
| Tests update | Each task includes test updates inline (TDD); Task 11 runs the full suite |
| Doc update SYSTEM-ARCHITECTURE.md §17 | Task 10 |
| Phase A validation gate (5 e2e runs + CloudWatch p95) | Task 13 |
| Phase A rollback posture | Task 14 step 5 (PR-based, revertable) |
| Backlog item ship | Task 14 |
| Out-of-scope items (onboarding-bff, sessions namespace, KB, etc.) | Not touched in any task |

All Phase A spec sections covered.

**Type/method consistency check:**
- `wrapAgentOutput` returns `{ kind: 'inline'; value: Record<string, unknown> }` (Task 1) — used as `wrapped.value` in Tasks 4, 5, 6.
- `output.agentOutput` field name used consistently in Tasks 2 (SF state Parameters), 4-6 (Lambda handlers), 3 (AssemblePacket reads `event.detail.<agent>` shape — note: AssemblePacket's `event` field names are `investorProfile`, `marketAnalysis`, `portfolio`, `narrative` — these are the SF Parameters keys, NOT `agentOutput`. Task 2 step 4(c) plumbs `'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput'` etc., so AssemblePacket receives them at the top-level field names). Consistent.
- `MemoryClient.searchLongTermMemory` retained in all uses (Tasks 4, 5, 7).

**Placeholder scan:** none found. All steps have concrete code or commands.

**Phase B placeholder:** explicitly out of scope per plan header — covered in a separate plan written after Phase A ships.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-inter-agent-state-handoff-phase-a.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because each task touches different services and benefits from focused context.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Slower context turnover but keeps everything visible in this conversation.

**Which approach?**
