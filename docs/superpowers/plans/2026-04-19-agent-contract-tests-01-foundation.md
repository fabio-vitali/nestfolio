# Agent Contract Tests — Plan 1/3: Foundation (library + path aliases)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Position in series:**
1. **This plan** — foundation: `libs/agent-orchestrator` extensions + `tsconfig.base.json` aliases. Lands unused public API; no behaviour change.
2. Plan 2/3: `2026-04-19-agent-contract-tests-02-first-rollout.md` — first service (`advisory-narrative-ctrl`) + `AgentTraceTrap` helper class. Validates the end-to-end shape before templating.
3. Plan 3/3: `2026-04-19-agent-contract-tests-03-remaining-services.md` — portfolio-engine, investor-profile, decision-lifecycle, market-intelligence, onboarding + cross-phase verification.

**Goal of the series:** Add deterministic, process-metadata contract assertions to six agent-invoking e2e scenarios by emitting an `AgentTraceEnvelope` from `invokeOrchestrator` on every agent invocation, then asserting on the emitted events in the existing scenarios.

**Goal of THIS plan:** Ship the library and tsconfig prerequisites that every subsequent phase depends on. No service code changes. Existing callers of `invokeOrchestrator` stay working.

**Architecture:** A new `AgentTracer` (LangChain callback handler) accumulates process metadata during `graph.invoke`. A `TraceEmitter` interface + `EventBridgeTraceEmitter` implementation publishes an `AgentTraceEnvelope` to the service's domain EventBridge bus. `invokeOrchestrator` wires tracer → emitter in a `finally` block.

**Tech Stack:** TypeScript 5, LangChain.js (`@langchain/core`), LangGraph.js (`@langchain/langgraph`), AWS SDK v3 (`@aws-sdk/client-eventbridge`), Jest, Nx.

---

## Source of truth

- Design spec: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- Project conventions: `CLAUDE.md` (tests in `test/`, `pnpm nx` only, events-only inter-service comms)
- Layout prerequisite merged on `main` 2026-04-19 (all six agent services use `agents/<agent-name>/{graph.ts, server.ts, Dockerfile}`)

## Coordination with in-progress work

**Mock resilience (design in progress, see `project_mock_resilience.md`).** That work introduces `FakeLlm` env-var injection inside `libs/agent-orchestrator/src/agent-factory.ts` at `createAgentNode()` (the sole LLM injection point). This plan does NOT touch `agent-factory.ts` — tracing attaches via LangChain callbacks at `graph.invoke(input, { callbacks: [tracer] })` in `invokeOrchestrator`, which is orthogonal to where the LLM itself is constructed. Both streams of work converge on the same agent runtime but on disjoint surfaces:

- Mock resilience changes **what the LLM is** (real Bedrock vs. FakeLlm).
- Contract tests observe **what happens around the LLM** (callback events, tool calls, node transitions).

If mock-resilience lands first, the contract tests still run against FakeLlm-driven invocations and will observe the fake's `gen_ai.request.model`, `tool_call` events, and timing — envelope shape is identical either way. If this plan lands first, mock-resilience can be added without touching `invokeOrchestrator` or the tracer. No merge conflicts expected; verify by rebasing and running `pnpm nx test agent-orchestrator` before merge.

## Scope of this plan

- `libs/agent-orchestrator`: new `AgentTracer`, `TraceEmitter` interface, `EventBridgeTraceEmitter`, `NoopTraceEmitter`; extended `InvokeOptions` discriminated union; extended `invokeOrchestrator`; updated public API exports.
- `tsconfig.base.json`: four missing `@nestfolio/{service}/events` path aliases.

Out of scope (covered by later plans): service wiring, CDK grants, e2e helper class, scenario assertions.

## File structure

### New files in `libs/agent-orchestrator`
- `src/agent-tracer.ts` — `AgentTracer` class, `AgentTraceEnvelope` type, `AgentTraceEventDetail` type
- `src/emitters/types.ts` — `TraceEmitter` interface, `EmitContext` type
- `src/emitters/eventbridge-emitter.ts` — `EventBridgeTraceEmitter`
- `src/emitters/noop-emitter.ts` — `NoopTraceEmitter`
- `test/agent-tracer.test.ts`
- `test/emitters/eventbridge-emitter.test.ts`
- **Extend** existing `libs/agent-orchestrator/test/invoke-orchestrator.test.ts` in place. Do NOT overwrite — add the new `describe('invokeOrchestrator trace emission', ...)` block and a module-level type assertion.

> `NoopTraceEmitter` ships without a dedicated test — its only behaviour is `async emit() {}`, so a test asserting "resolves to undefined" is tautological. The interface compliance is proven by `invoke-orchestrator.test.ts`'s `skips emission when emitter is absent` path.

> Note on layout: libs use flat `test/**` because they have no integration tests. Only services use `test/unit/**` (and `test/integration/**`).

### Modified files in `libs/agent-orchestrator`
- `src/create-orchestrator.ts` — widen `CompiledGraph.invoke` to accept `RunnableConfig` (so `invokeOrchestrator` can pass `{ callbacks }`)
- `src/types.ts` — extend `InvokeOptions` with `agent`, `correlationId`, `tenantId`, `emitter`
- `src/invoke-orchestrator.ts` — wire tracer, emit in `finally`
- `src/index.ts` — export new public API
- `package.json` — verify `@aws-sdk/client-eventbridge` and `aws-sdk-client-mock` present

### Modified repo-root files
- `tsconfig.base.json` — add missing `@nestfolio/{advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,onboarding-bff}/events` path aliases

## Testing strategy (this plan)

Library unit tests only. AgentTracer isolated from LangChain — drive the handler methods directly, assert envelope shape (including parallel-chain runId attribution). EventBridgeTraceEmitter with mocked `EventBridgeClient`. invokeOrchestrator with a `TraceEmitter` spy + fake graph covering success / error / emitter-throws paths.

Service-side CDK assertion tests and e2e scenarios live in the follow-up plans.

## Verification commands reference

- Build one project: `pnpm nx build <project>`
- Unit test one project: `pnpm nx test <project>`
- Typecheck: `pnpm nx typecheck <project>` or `pnpm nx run-many -t typecheck`
- Lint: `pnpm nx lint <project>`
- Affected: `pnpm nx affected -t test,build,lint`

---

# Phase 1 — Core library: AgentTracer, TraceEmitter, invokeOrchestrator extension

**Shippable outcome:** `@nestfolio/agent-orchestrator` exports `AgentTracer`, `AgentTraceEnvelope`, `TraceEmitter`, `EventBridgeTraceEmitter`, `NoopTraceEmitter`, and an extended `InvokeOptions`. Existing callers unaffected.

**Files:**
- Create: `libs/agent-orchestrator/src/agent-tracer.ts`
- Create: `libs/agent-orchestrator/src/emitters/types.ts`
- Create: `libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts`
- Create: `libs/agent-orchestrator/src/emitters/noop-emitter.ts`
- Modify: `libs/agent-orchestrator/src/create-orchestrator.ts` (widen `CompiledGraph.invoke` signature)
- Modify: `libs/agent-orchestrator/src/types.ts`
- Modify: `libs/agent-orchestrator/src/invoke-orchestrator.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`
- Modify: `libs/agent-orchestrator/package.json` (verify `@aws-sdk/client-eventbridge` + `aws-sdk-client-mock`)
- Test: `libs/agent-orchestrator/test/agent-tracer.test.ts`
- Test: `libs/agent-orchestrator/test/emitters/eventbridge-emitter.test.ts`
- Test: `libs/agent-orchestrator/test/invoke-orchestrator.test.ts` (already exists — extend in place)

## Task 1.1 — AgentTraceEnvelope type + `AgentTracer` skeleton

- [ ] **Step 1: Create `agent-tracer.ts` with types and empty handler class**

Content for `libs/agent-orchestrator/src/agent-tracer.ts`:

```ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import type { ModelTier } from './types';

export interface AgentTraceEnvelope {
  'gen_ai.invocation.started_at': string;
  'gen_ai.invocation.completed_at': string;
  'gen_ai.invocation.latency_ms': number;
  status: 'success' | 'error';
  llmCalls: Array<{
    nodeName: string;
    // `'unknown'` signals an unrecognised Bedrock model id — fail loudly rather
    // than silently mis-classifying a new tier as sonnet.
    'gen_ai.request.model': ModelTier | 'unknown';
    'gen_ai.usage.input_tokens': number;
    'gen_ai.usage.output_tokens': number;
    'gen_ai.operation.name': 'chat';
    latencyMs: number;
    // Set only when the current tier strictly outranks the previous one
    // (haiku < sonnet < opus). Fallbacks / de-escalations / unknown-tier
    // transitions leave this undefined.
    escalatedFromTier?: ModelTier;
  }>;
  toolCalls: Array<{
    nodeName: string;
    toolName: string;
    status: 'success' | 'error';
    latencyMs: number;
    argKeys: string[];
    resultKeys?: string[];
  }>;
  nodeSequence: Array<{ nodeName: string; startedAt: string; completedAt: string }>;
  errors: Array<{ nodeName?: string; kind: string; message: string }>;
}

export interface AgentTraceEventDetail {
  context: { tenantId: string };
  correlationId: string;
  agent: string;
  envelope: AgentTraceEnvelope;
  emittedAt: string;
}

// Tier rank for rank-based escalation detection. Used only when both the
// previous and current tier are known ModelTiers.
const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

export class AgentTracer extends BaseCallbackHandler {
  name = 'agent-tracer';

  private readonly startedAtMs = Date.now();
  private readonly llmCalls: AgentTraceEnvelope['llmCalls'] = [];
  private readonly toolCalls: AgentTraceEnvelope['toolCalls'] = [];
  private readonly nodeSequence: AgentTraceEnvelope['nodeSequence'] = [];
  private readonly errors: AgentTraceEnvelope['errors'] = [];
  private readonly pendingLlm = new Map<string, { model: ModelTier | 'unknown'; startedAtMs: number; node?: string }>();
  private readonly pendingTool = new Map<string, { toolName: string; startedAtMs: number; argKeys: string[]; node?: string }>();
  // Keyed by LangChain runId. Acts as BOTH the node-sequence buffer (so
  // parallel chain start/end cannot mis-attribute completedAt timestamps)
  // AND the authoritative lookup for "which node owns run X" — used by
  // LLM / tool callbacks via their `parentRunId` argument.
  private readonly pendingChains = new Map<string, { nodeName: string; startedAt: string }>();
  private lastTier?: ModelTier | 'unknown';

  build(status: 'success' | 'error'): AgentTraceEnvelope {
    const completedAtMs = Date.now();
    return {
      'gen_ai.invocation.started_at': new Date(this.startedAtMs).toISOString(),
      'gen_ai.invocation.completed_at': new Date(completedAtMs).toISOString(),
      'gen_ai.invocation.latency_ms': completedAtMs - this.startedAtMs,
      status,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      nodeSequence: this.nodeSequence,
      errors: this.errors,
    };
  }
}

export function extractNodeName(chain: Serialized | undefined): string | undefined {
  if (!chain) return undefined;
  const kwargs = (chain as { kwargs?: { name?: string } }).kwargs;
  if (kwargs?.name) return kwargs.name;
  const idSegments = (chain as { id?: string[] }).id;
  if (Array.isArray(idSegments) && idSegments.length > 0) return idSegments[idSegments.length - 1];
  return undefined;
}

export function extractModelTier(llm: Serialized | undefined): ModelTier | 'unknown' {
  const kwargs = (llm as { kwargs?: { model?: string; modelName?: string; model_id?: string } } | undefined)?.kwargs;
  const modelId = kwargs?.model ?? kwargs?.modelName ?? kwargs?.model_id ?? '';
  if (/haiku/i.test(modelId)) return 'haiku';
  if (/opus/i.test(modelId)) return 'opus';
  if (/sonnet/i.test(modelId)) return 'sonnet';
  // Deliberately NOT defaulting to sonnet: an unknown model id should fail
  // assertions loudly rather than masquerade as the expected tier.
  return 'unknown';
}

export function extractToolName(tool: Serialized | undefined): string {
  if (!tool) return 'unknown';
  const kwargs = (tool as { kwargs?: { name?: string } }).kwargs;
  if (kwargs?.name) return kwargs.name;
  const id = (tool as { id?: string[] }).id;
  if (Array.isArray(id) && id.length > 0) return id[id.length - 1];
  return 'unknown';
}
```

- [ ] **Step 2: Write unit test for `build()` producing a minimal envelope**

Content for `libs/agent-orchestrator/test/agent-tracer.test.ts`:

```ts
import { AgentTracer, extractNodeName, extractModelTier, extractToolName } from '../src/agent-tracer';

describe('AgentTracer.build()', () => {
  it('returns envelope with empty arrays and success status when nothing observed', () => {
    const tracer = new AgentTracer();
    const env = tracer.build('success');
    expect(env.status).toBe('success');
    expect(env.llmCalls).toEqual([]);
    expect(env.toolCalls).toEqual([]);
    expect(env.nodeSequence).toEqual([]);
    expect(env.errors).toEqual([]);
    expect(env['gen_ai.invocation.latency_ms']).toBeGreaterThanOrEqual(0);
    expect(new Date(env['gen_ai.invocation.started_at']).toString()).not.toBe('Invalid Date');
    expect(new Date(env['gen_ai.invocation.completed_at']).toString()).not.toBe('Invalid Date');
  });

  it('returns envelope with error status when error passed', () => {
    const tracer = new AgentTracer();
    const env = tracer.build('error');
    expect(env.status).toBe('error');
  });
});

describe('extract helpers', () => {
  it('extractNodeName reads kwargs.name first, then last id segment', () => {
    expect(extractNodeName({ kwargs: { name: 'portfolioConstruction' } } as any)).toBe('portfolioConstruction');
    expect(extractNodeName({ id: ['langchain', 'nodes', 'goalExtraction'] } as any)).toBe('goalExtraction');
    expect(extractNodeName(undefined)).toBeUndefined();
  });
  it('extractModelTier maps Bedrock inference profile ids to tier names', () => {
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-haiku-4-5' } } as any)).toBe('haiku');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-opus-4-7' } } as any)).toBe('opus');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-sonnet-4-6' } } as any)).toBe('sonnet');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-sonnet-4-7' } } as any)).toBe('sonnet');
    expect(extractModelTier({ kwargs: {} } as any)).toBe('unknown');
    expect(extractModelTier({ kwargs: { model: 'us.amazon.nova-pro-v1:0' } } as any)).toBe('unknown');
  });
  it('extractToolName reads kwargs.name first, then last id segment', () => {
    expect(extractToolName({ kwargs: { name: 'portfolio-lookup' } } as any)).toBe('portfolio-lookup');
    expect(extractToolName({ id: ['tools', 'market-data'] } as any)).toBe('market-data');
    expect(extractToolName(undefined)).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run tests — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=agent-tracer`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/test/agent-tracer.test.ts
git commit -m "feat(agent-orchestrator): add AgentTracer skeleton and envelope types"
```

## Task 1.2 — AgentTracer LangChain callbacks

- [ ] **Step 1: Extend `AgentTracer` with all LangChain lifecycle handlers**

Append the following methods to the `AgentTracer` class in `libs/agent-orchestrator/src/agent-tracer.ts` (before `build()`):

```ts
  // Node ownership for LLM/tool runs is resolved via `parentRunId` — the runId
  // of the chain that invoked them. No shared `currentNode` field: when two
  // nodes fan out in parallel (portfolio-engine, investor-profile wave), a
  // mutable "current node" pointer would attribute LLM/tool calls to whichever
  // chain started most recently instead of the actual parent.
  private nodeFor(parentRunId: string | undefined): string | undefined {
    return parentRunId ? this.pendingChains.get(parentRunId)?.nodeName : undefined;
  }

  handleChainStart(chain: Serialized, _inputs: unknown, runId: string): void {
    const nodeName = extractNodeName(chain);
    if (!nodeName) return;
    this.pendingChains.set(runId, { nodeName, startedAt: new Date().toISOString() });
  }

  handleChainEnd(_outputs: unknown, runId: string): void {
    const pending = this.pendingChains.get(runId);
    if (!pending) return;
    this.pendingChains.delete(runId);
    this.nodeSequence.push({
      nodeName: pending.nodeName,
      startedAt: pending.startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  handleChainError(err: Error, runId: string): void {
    const pending = this.pendingChains.get(runId);
    this.errors.push({ nodeName: pending?.nodeName, kind: 'chain_error', message: err.message });
  }

  // LangChain signature: (llm, prompts, runId, parentRunId?, extraParams?, tags?, metadata?, runName?)
  handleLLMStart(llm: Serialized, _prompts: string[], runId: string, parentRunId?: string): void {
    const model = extractModelTier(llm);
    this.pendingLlm.set(runId, { model, startedAtMs: Date.now(), node: this.nodeFor(parentRunId) });
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const pending = this.pendingLlm.get(runId);
    if (!pending) return;
    this.pendingLlm.delete(runId);
    const rawUsage =
      (output.llmOutput as { tokenUsage?: Record<string, number>; usage?: Record<string, number> } | undefined);
    const usage = rawUsage?.tokenUsage ?? rawUsage?.usage ?? {};
    // Rank-based escalation: only set when both tiers are known AND the new
    // tier strictly outranks the previous one. Fallbacks (opus→sonnet) and
    // unknown-tier transitions leave escalatedFromTier undefined — the field
    // means "escalated from", not "differs from".
    const prev = this.lastTier;
    const cur = pending.model;
    const escalatedFromTier =
      prev && prev !== 'unknown' && cur !== 'unknown' && TIER_RANK[cur] > TIER_RANK[prev]
        ? prev
        : undefined;
    this.llmCalls.push({
      nodeName: pending.node ?? 'unknown',
      'gen_ai.request.model': pending.model,
      'gen_ai.usage.input_tokens': Number(usage.input_tokens ?? usage.promptTokens ?? 0),
      'gen_ai.usage.output_tokens': Number(usage.output_tokens ?? usage.completionTokens ?? 0),
      'gen_ai.operation.name': 'chat',
      latencyMs: Date.now() - pending.startedAtMs,
      escalatedFromTier,
    });
    this.lastTier = pending.model;
  }

  handleLLMError(err: Error, runId: string): void {
    const pending = this.pendingLlm.get(runId);
    this.errors.push({ nodeName: pending?.node, kind: 'llm_error', message: err.message });
  }

  // LangChain signature: (tool, input, runId, parentRunId?, tags?, metadata?, runName?)
  handleToolStart(tool: Serialized, input: string, runId: string, parentRunId?: string): void {
    const toolName = extractToolName(tool);
    let argKeys: string[] = [];
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') argKeys = Object.keys(parsed);
    } catch {
      /* non-JSON input — argKeys stays empty */
    }
    this.pendingTool.set(runId, {
      toolName,
      startedAtMs: Date.now(),
      argKeys,
      node: this.nodeFor(parentRunId),
    });
  }

  handleToolEnd(output: string, runId: string): void {
    const pending = this.pendingTool.get(runId);
    if (!pending) return;
    this.pendingTool.delete(runId);
    let resultKeys: string[] | undefined;
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') resultKeys = Object.keys(parsed);
    } catch {
      /* non-JSON output — resultKeys stays undefined */
    }
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'success',
      latencyMs: Date.now() - pending.startedAtMs,
      argKeys: pending.argKeys,
      resultKeys,
    });
  }

  handleToolError(err: Error, runId: string): void {
    const pending = this.pendingTool.get(runId);
    if (!pending) return;
    this.pendingTool.delete(runId);
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'error',
      latencyMs: Date.now() - pending.startedAtMs,
      argKeys: pending.argKeys,
    });
    this.errors.push({ nodeName: pending.node, kind: 'tool_error', message: err.message });
  }
```

- [ ] **Step 2: Extend unit tests to exercise each callback path**

Append to `libs/agent-orchestrator/test/agent-tracer.test.ts`:

```ts
describe('AgentTracer LangChain callbacks', () => {
  it('records a chain start/end pair into nodeSequence', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-1');
    tracer.handleChainEnd({}, 'run-1');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(1);
    expect(env.nodeSequence[0].nodeName).toBe('nodeA');
    expect(env.nodeSequence[0].completedAt).not.toBe('');
  });

  it('ignores chains without an extractable node name', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({} as any, {}, 'run-1');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(0);
  });

  it('attributes completedAt to the correct chain when two run in parallel (interleaved start/end)', () => {
    // Simulates parallel nodes — e.g. portfolio-engine and investor-profile fan-out.
    // If nodeSequence were keyed by "last array entry" instead of runId, chain A's
    // completedAt would land on chain B's record.
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'run-B');
    tracer.handleChainEnd({}, 'run-A'); // A finishes first
    tracer.handleChainEnd({}, 'run-B');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(2);
    const byName = Object.fromEntries(env.nodeSequence.map((n) => [n.nodeName, n]));
    expect(byName['nodeA'].completedAt).not.toBe('');
    expect(byName['nodeB'].completedAt).not.toBe('');
    // Both records carry their own startedAt/completedAt, not each other's.
    expect(new Date(byName['nodeA'].completedAt).getTime())
      .toBeLessThanOrEqual(new Date(byName['nodeB'].completedAt).getTime());
  });

  it('records an LLM call with token usage from tokenUsage', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart(
      { kwargs: { model: 'us.anthropic.claude-sonnet-4-6' } } as any,
      ['prompt'],
      'run-1',
    );
    tracer.handleLLMEnd(
      { generations: [], llmOutput: { tokenUsage: { input_tokens: 100, output_tokens: 50 } } } as any,
      'run-1',
    );
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(1);
    expect(env.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
    expect(env.llmCalls[0]['gen_ai.usage.input_tokens']).toBe(100);
    expect(env.llmCalls[0]['gen_ai.usage.output_tokens']).toBe(50);
    expect(env.llmCalls[0]['gen_ai.operation.name']).toBe('chat');
    expect(env.llmCalls[0].escalatedFromTier).toBeUndefined();
  });

  it('records escalatedFromTier when successive LLM calls escalate upward', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'haiku-x' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(2);
    expect(env.llmCalls[1].escalatedFromTier).toBe('haiku');
  });

  it('leaves escalatedFromTier undefined when tier de-escalates (e.g. opus→sonnet)', () => {
    // The field means "escalated from", not "differs from". A fallback to a
    // cheaper tier must not masquerade as escalation.
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'opus-x' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls[1].escalatedFromTier).toBeUndefined();
  });

  it('leaves escalatedFromTier undefined when either tier is unknown', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'nova-pro' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls[0]['gen_ai.request.model']).toBe('unknown');
    expect(env.llmCalls[1].escalatedFromTier).toBeUndefined();
  });

  it('attributes LLM calls to the correct node when two nodes run in parallel', () => {
    // Regression: if node attribution went through a shared `currentNode`
    // field, whichever chain started most recently would own every LLM call
    // until the next chain started. Here LLM-A and LLM-B interleave between
    // chains A and B and must each keep their own node.
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'chain-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'chain-B');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'llm-A', 'chain-A');
    tracer.handleLLMStart({ kwargs: { model: 'haiku-x' } } as any, [], 'llm-B', 'chain-B');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'llm-B');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'llm-A');
    tracer.handleChainEnd({}, 'chain-A');
    tracer.handleChainEnd({}, 'chain-B');
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(2);
    const byNode = Object.fromEntries(env.llmCalls.map((c) => [c.nodeName, c]));
    expect(byNode['nodeA']['gen_ai.request.model']).toBe('sonnet');
    expect(byNode['nodeB']['gen_ai.request.model']).toBe('haiku');
  });

  it('attributes tool calls to the correct node when two nodes run in parallel', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'chain-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'chain-B');
    tracer.handleToolStart({ kwargs: { name: 'toolA' } } as any, '{}', 'tool-A', 'chain-A');
    tracer.handleToolStart({ kwargs: { name: 'toolB' } } as any, '{}', 'tool-B', 'chain-B');
    tracer.handleToolEnd('{}', 'tool-B');
    tracer.handleToolEnd('{}', 'tool-A');
    tracer.handleChainEnd({}, 'chain-A');
    tracer.handleChainEnd({}, 'chain-B');
    const env = tracer.build('success');
    const byTool = Object.fromEntries(env.toolCalls.map((c) => [c.toolName, c]));
    expect(byTool['toolA'].nodeName).toBe('nodeA');
    expect(byTool['toolB'].nodeName).toBe('nodeB');
  });

  it('records a tool call with argKeys and resultKeys derived from JSON', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 'portfolio-lookup' } } as any, '{"tenantId":"t","decisionId":"d"}', 'run-1');
    tracer.handleToolEnd('{"positions":[],"cash":0}', 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls).toHaveLength(1);
    expect(env.toolCalls[0].toolName).toBe('portfolio-lookup');
    expect(env.toolCalls[0].argKeys.sort()).toEqual(['decisionId', 'tenantId']);
    expect(env.toolCalls[0].resultKeys?.sort()).toEqual(['cash', 'positions']);
    expect(env.toolCalls[0].status).toBe('success');
  });

  it('records tool error with status error and an error entry', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 'market-data' } } as any, '{}', 'run-1');
    tracer.handleToolError(new Error('boom'), 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls[0].status).toBe('error');
    expect(env.errors).toContainEqual({ nodeName: undefined, kind: 'tool_error', message: 'boom' });
  });

  it('records chain error', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-1');
    tracer.handleChainError(new Error('chain-fail'), 'run-1');
    const env = tracer.build('error');
    expect(env.errors).toContainEqual({ nodeName: 'nodeA', kind: 'chain_error', message: 'chain-fail' });
  });

  it('records llm error without consuming a matching pending run', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMError(new Error('llm-fail'), 'run-1');
    const env = tracer.build('error');
    expect(env.errors).toContainEqual({ nodeName: undefined, kind: 'llm_error', message: 'llm-fail' });
  });

  it('handles non-JSON tool input and output gracefully (argKeys empty, resultKeys undefined)', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 't' } } as any, 'not-json', 'run-1');
    tracer.handleToolEnd('still-not-json', 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls[0].argKeys).toEqual([]);
    expect(env.toolCalls[0].resultKeys).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=agent-tracer`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/test/agent-tracer.test.ts
git commit -m "feat(agent-orchestrator): wire LangChain callbacks in AgentTracer"
```

## Task 1.3 — TraceEmitter interface + NoopTraceEmitter

- [ ] **Step 1: Create `emitters/types.ts`**

Content for `libs/agent-orchestrator/src/emitters/types.ts`:

```ts
import type { AgentTraceEnvelope } from '../agent-tracer';

export interface EmitContext {
  tenantId: string;
  correlationId: string;
  agent: string;
}

export interface TraceEmitter {
  emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void>;
}
```

- [ ] **Step 2: Create `emitters/noop-emitter.ts`**

Content for `libs/agent-orchestrator/src/emitters/noop-emitter.ts`:

```ts
import type { TraceEmitter } from './types';

export class NoopTraceEmitter implements TraceEmitter {
  async emit(): Promise<void> {
    /* no-op */
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm nx typecheck agent-orchestrator`
Expected: pass.

> No dedicated test for `NoopTraceEmitter` — its only behaviour is `async emit() {}`, so "resolves to undefined" is tautological. Interface conformance is proven in Task 1.5 via the `invokeOrchestrator` tests.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-orchestrator/src/emitters/
git commit -m "feat(agent-orchestrator): add TraceEmitter interface and NoopTraceEmitter"
```

## Task 1.4 — EventBridgeTraceEmitter

- [ ] **Step 1: Write failing test for EventBridgeTraceEmitter**

Content for `libs/agent-orchestrator/test/emitters/eventbridge-emitter.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventName } from '@nestfolio/event-types';
import { EventBridgeTraceEmitter } from '../../src/emitters/eventbridge-emitter';
import type { AgentTraceEnvelope } from '../../src/agent-tracer';

const ebMock = mockClient(EventBridgeClient);

describe('EventBridgeTraceEmitter', () => {
  beforeEach(() => { ebMock.reset(); });

  const baseEnvelope: AgentTraceEnvelope = {
    'gen_ai.invocation.started_at': new Date(0).toISOString(),
    'gen_ai.invocation.completed_at': new Date(1000).toISOString(),
    'gen_ai.invocation.latency_ms': 1000,
    status: 'success',
    llmCalls: [],
    toolCalls: [],
    nodeSequence: [],
    errors: [],
  };

  it('emits a PutEventsCommand with the supplied source, detailType, bus, and serialised detail', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'e1' }] });
    const emitter = new EventBridgeTraceEmitter({
      busName: 'advisory-bus',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });

    await emitter.emit(baseEnvelope, { tenantId: 'tenant-1', correlationId: 'decision-1', agent: 'decision-lifecycle' });

    const call = ebMock.commandCalls(PutEventsCommand).at(0);
    expect(call).toBeDefined();
    const entry = call!.args[0].input.Entries![0];
    expect(entry.Source).toBe('agent-orchestrator@advisory-ctrl');
    expect(entry.DetailType).toBe('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED');
    expect(entry.EventBusName).toBe('advisory-bus');
    const detail = JSON.parse(entry.Detail!);
    expect(detail.context.tenantId).toBe('tenant-1');
    expect(detail.correlationId).toBe('decision-1');
    expect(detail.agent).toBe('decision-lifecycle');
    expect(detail.envelope).toEqual(baseEnvelope);
    expect(new Date(detail.emittedAt).toString()).not.toBe('Invalid Date');
  });

  it('is a no-op when busName is empty — no PutEvents call issued', async () => {
    const emitter = new EventBridgeTraceEmitter({
      busName: '',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });
    await emitter.emit(baseEnvelope, { tenantId: 't', correlationId: 'c', agent: 'a' });
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('propagates errors from the underlying client', async () => {
    ebMock.on(PutEventsCommand).rejects(new Error('eb-down'));
    const emitter = new EventBridgeTraceEmitter({
      busName: 'advisory-bus',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });
    await expect(
      emitter.emit(baseEnvelope, { tenantId: 't', correlationId: 'c', agent: 'a' }),
    ).rejects.toThrow('eb-down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module missing)**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=eventbridge-emitter`
Expected: FAIL — `Cannot find module '../../../src/emitters/eventbridge-emitter'`.

- [ ] **Step 3: Implement `EventBridgeTraceEmitter`**

Content for `libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts`:

```ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventName } from '@nestfolio/event-types';
import type { AgentTraceEnvelope } from '../agent-tracer';
import type { EmitContext, TraceEmitter } from './types';

export interface EventBridgeTraceEmitterOptions {
  /** Event bus name/ARN. If empty/undefined, `emit()` becomes a no-op (see constructor). */
  busName: string | undefined;
  source: string;
  detailType: EventName;
  region?: string;
  client?: EventBridgeClient;
}

export class EventBridgeTraceEmitter implements TraceEmitter {
  private readonly client: EventBridgeClient;

  constructor(private readonly opts: EventBridgeTraceEmitterOptions) {
    this.client = opts.client ?? new EventBridgeClient({ region: opts.region ?? 'us-east-1' });
  }

  async emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void> {
    // No-op when busName is absent. This lets agent servers construct the
    // emitter eagerly at module load even when EVENT_BUS_NAME is not set
    // (local dev, unit tests that exercise the server without AWS wiring).
    // Without this guard, a missing env var would fail-fast on first invocation.
    if (!this.opts.busName) return;
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: this.opts.source,
            DetailType: this.opts.detailType,
            EventBusName: this.opts.busName,
            Detail: JSON.stringify({
              // `context.tenantId` wrapping is REQUIRED: matches workspace
              // envelope convention (see libs/event-processor parsers) and the
              // EventBusTrap filter (libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
              // line 70-76) which matches on `detail.context.tenantId`.
              context: { tenantId: ctx.tenantId },
              correlationId: ctx.correlationId,
              agent: ctx.agent,
              envelope,
              emittedAt: new Date().toISOString(),
            }),
          },
        ],
      }),
    );
  }
}
```

- [ ] **Step 4: Verify `aws-sdk-client-mock` is reachable**

Run:
```bash
grep -E '"aws-sdk-client-mock"|"@aws-sdk/client-eventbridge"' libs/agent-orchestrator/package.json package.json
```

`aws-sdk-client-mock` is used across the repo (e.g. `services/advisory/portfolio-engine-ctrl/test/unit/`). If it is hoisted to the workspace root `package.json` devDependencies, no action needed. If it is missing from both, install as a workspace dev dep:

```bash
pnpm add -D -w aws-sdk-client-mock
```

Confirm `@aws-sdk/client-eventbridge` resolves from `libs/agent-orchestrator`. If not present in its `package.json`, add it:

```bash
pnpm add -F @nestfolio/agent-orchestrator @aws-sdk/client-eventbridge
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=eventbridge-emitter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts libs/agent-orchestrator/test/emitters/eventbridge-emitter.test.ts libs/agent-orchestrator/package.json
git commit -m "feat(agent-orchestrator): add EventBridgeTraceEmitter"
```

## Task 1.5 — Extend `InvokeOptions` + `invokeOrchestrator`

- [ ] **Step 1: Widen `CompiledGraph.invoke` to accept `RunnableConfig`**

`invokeOrchestrator` needs to pass `{ callbacks: [tracer] }` as the second argument to `graph.invoke`. The existing interface at `libs/agent-orchestrator/src/create-orchestrator.ts` declares only `invoke(input)` — typecheck will fail on the new call. Widen it:

```ts
import type { RunnableConfig } from '@langchain/core/runnables';

export interface CompiledGraph {
  invoke(
    input: Record<string, unknown>,
    config?: RunnableConfig,
  ): Promise<Record<string, unknown>>;
}
```

The existing `graph.compile() as unknown as CompiledGraph` cast at the bottom of `create-orchestrator.ts` is compatible — the real LangGraph-compiled graph already accepts `RunnableConfig`. Existing callers passing only `input` continue to work (second arg is optional).

- [ ] **Step 2: Extend `InvokeOptions` in `types.ts` using a discriminated union**

Modify `libs/agent-orchestrator/src/types.ts`. Replace the existing `InvokeOptions` interface with a discriminated union that makes `agent` + `correlationId` REQUIRED whenever an `emitter` is passed. Callers that omit the emitter keep the minimal shape:

```ts
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Metrics } from '@aws-lambda-powertools/metrics';
import type { TraceEmitter } from './emitters/types';

// ...existing types unchanged...

interface BaseInvokeOptions {
  readonly logger?: Logger;
  readonly metrics?: Metrics;
}

interface InvokeOptionsWithoutEmitter extends BaseInvokeOptions {
  readonly emitter?: undefined;
  readonly agent?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
}

interface InvokeOptionsWithEmitter extends BaseInvokeOptions {
  readonly emitter: TraceEmitter;
  readonly agent: string;          // REQUIRED when emitter is set
  readonly correlationId: string;  // REQUIRED when emitter is set
  readonly tenantId?: string;      // optional — falls back to '' (the tracer does not need tenant-identity to build an envelope; emitter must still receive a string)
}

export type InvokeOptions = InvokeOptionsWithoutEmitter | InvokeOptionsWithEmitter;
```

Note: current `InvokeOptions` uses `unknown` for `logger`/`metrics`; upgrade to the concrete types from Powertools to preserve compile-time typing when tests pass real instances. Remove the `unknown` aliases. The union eliminates the runtime guard `options.emitter && options.correlationId && options.agent` — the type system now enforces that if an emitter is present, so are `agent` and `correlationId`, so the `finally` block can call `options.emitter.emit(...)` without the runtime existence checks.

- [ ] **Step 3: Write failing test extending `invokeOrchestrator` behaviour**

The file `libs/agent-orchestrator/test/invoke-orchestrator.test.ts` already exists and imports `invokeOrchestrator` + `CompiledGraph`. **Extend it in place**:

1. Add these imports alongside the existing ones (do NOT duplicate the two that are already there):
   ```ts
   import type { TraceEmitter } from '../src/emitters/types';
   import type { AgentTraceEnvelope } from '../src/agent-tracer';
   ```
2. Append the `makeGraph` helper and the new `describe('invokeOrchestrator trace emission', ...)` block after the existing `describe('invokeOrchestrator', ...)` block.
3. Append the module-level type-check constant at the very bottom of the file (not inside any `describe` or `it`).

```ts
function makeGraph(result: Record<string, unknown> | Error): CompiledGraph {
  const invoke: CompiledGraph['invoke'] = jest.fn(
    async (_input: Record<string, unknown>, _config?: unknown) => {
      if (result instanceof Error) throw result;
      return result;
    },
  ) as unknown as CompiledGraph['invoke'];
  return { invoke };
}

describe('invokeOrchestrator trace emission', () => {
  it('calls emitter.emit on success when emitter and correlationId provided', async () => {
    const emitted: Array<{ envelope: AgentTraceEnvelope; ctx: unknown }> = [];
    const emitter: TraceEmitter = { emit: async (envelope, ctx) => { emitted.push({ envelope, ctx }); } };
    const graph = makeGraph({ ok: true });

    const out = await invokeOrchestrator(graph, { foo: 'bar' }, {
      emitter, correlationId: 'decision-1', agent: 'decision-lifecycle', tenantId: 'tenant-1',
    });

    expect(out).toEqual({ ok: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].envelope.status).toBe('success');
    expect(emitted[0].ctx).toEqual({ correlationId: 'decision-1', tenantId: 'tenant-1', agent: 'decision-lifecycle' });
  });

  it('calls emitter.emit with status error when graph throws', async () => {
    const emitted: Array<{ envelope: AgentTraceEnvelope }> = [];
    const emitter: TraceEmitter = { emit: async (envelope) => { emitted.push({ envelope }); } };
    const graph = makeGraph(new Error('boom'));

    const out = await invokeOrchestrator(graph, {}, {
      emitter, correlationId: 'decision-1', agent: 'decision-lifecycle', tenantId: 'tenant-1',
    });

    expect(out).toEqual({ serviceUnavailable: true, reason: 'boom' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].envelope.status).toBe('error');
  });

  it('skips emission when emitter is absent', async () => {
    const graph = makeGraph({ ok: true });
    // Without emitter, agent/correlationId are optional — passing them here is harmless.
    const out = await invokeOrchestrator(graph, {}, { correlationId: 'x', agent: 'a' });
    expect(out).toEqual({ ok: true });
  });

  it('swallows emitter errors and still returns the orchestrator result', async () => {
    const emitter: TraceEmitter = { emit: async () => { throw new Error('emit-fail'); } };
    const graph = makeGraph({ ok: true });
    const out = await invokeOrchestrator(graph, {}, {
      emitter, correlationId: 'x', agent: 'a',
    });
    expect(out).toEqual({ ok: true });
  });

  it('attaches AgentTracer to graph.invoke callbacks', async () => {
    let capturedCallbacks: unknown;
    const graph: CompiledGraph = {
      invoke: jest.fn(async (_input, config) => {
        capturedCallbacks = (config as { callbacks?: unknown })?.callbacks;
        return { ok: true };
      }) as unknown as CompiledGraph['invoke'],
    };

    await invokeOrchestrator(graph, {}, { correlationId: 'x', agent: 'a' });

    expect(Array.isArray(capturedCallbacks)).toBe(true);
    expect((capturedCallbacks as Array<{ name?: string }>)[0]?.name).toBe('agent-tracer');
  });
});

// Module-level type-only assertion: the `InvokeOptions` discriminated union
// must reject `{ emitter }` without `agent` + `correlationId`. Checked by
// `pnpm nx typecheck`, not by Jest. If the `@ts-expect-error` ever stops
// flagging, the union has regressed and this line will fail compile.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertEmitterRequiresAgent: Parameters<typeof invokeOrchestrator>[2] =
  // @ts-expect-error agent and correlationId are required when emitter is set
  { emitter: { emit: async () => { /* noop */ } } };
```

- [ ] **Step 4: Run test to verify it fails (old invokeOrchestrator doesn't emit or attach callbacks)**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=invoke-orchestrator`
Expected: FAIL — emission tests fail because current implementation ignores `emitter`.

- [ ] **Step 5: Rewrite `invoke-orchestrator.ts` to attach tracer + emit in finally**

Replace content of `libs/agent-orchestrator/src/invoke-orchestrator.ts` with:

```ts
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { CompiledGraph } from './create-orchestrator';
import type { ServiceUnavailableResponse, InvokeOptions } from './types';
import { AgentTracer } from './agent-tracer';

const defaultLogger = new Logger({ serviceName: 'agent-orchestrator' });
const defaultMetrics = new Metrics({ namespace: 'AgentOrchestrator' });

export async function invokeOrchestrator(
  graph: CompiledGraph,
  input: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<Record<string, unknown> | ServiceUnavailableResponse> {
  const logger = options?.logger ?? defaultLogger;
  const metrics = options?.metrics ?? defaultMetrics;
  const tracer = new AgentTracer();
  const startTime = Date.now();
  let status: 'success' | 'error' = 'success';
  let result: Record<string, unknown> | ServiceUnavailableResponse;

  logger.info('Orchestrator invocation started', { inputKeys: Object.keys(input) });

  try {
    result = await graph.invoke(input, { callbacks: [tracer] });
    const duration = Date.now() - startTime;
    logger.info('Orchestrator invocation completed', { duration });
    metrics.addMetric('OrchestratorSuccess', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);
    return result;
  } catch (error) {
    status = 'error';
    const duration = Date.now() - startTime;
    const reason = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Orchestrator invocation failed', { duration, reason });
    metrics.addMetric('OrchestratorFailure', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);
    result = { serviceUnavailable: true, reason };
    return result;
  } finally {
    const envelope = tracer.build(status);
    // Narrow via the discriminant: if emitter is present, the type system
    // guarantees `agent` and `correlationId` are also present (see InvokeOptions).
    if (options?.emitter) {
      try {
        await options.emitter.emit(envelope, {
          tenantId: options.tenantId ?? '',
          correlationId: options.correlationId,
          agent: options.agent,
        });
      } catch (emitErr) {
        logger.warn('Trace emission failed', { err: emitErr });
      }
    }
  }
}
```

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=invoke-orchestrator`
Expected: PASS.

- [ ] **Step 7: Run the full library test suite — must stay green**

Run: `pnpm nx test agent-orchestrator`
Expected: all tests pass. Any test calling `invokeOrchestrator` with no `options` must still work (emission skipped when `emitter` is undefined).

- [ ] **Step 8: Commit**

```bash
git add libs/agent-orchestrator/src/create-orchestrator.ts libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/src/invoke-orchestrator.ts libs/agent-orchestrator/test/invoke-orchestrator.test.ts
git commit -m "feat(agent-orchestrator): emit AgentTraceEnvelope from invokeOrchestrator"
```

## Task 1.6 — Export public API from `index.ts`

- [ ] **Step 1: Update exports**

Modify `libs/agent-orchestrator/src/index.ts` — add these exports before the existing trailing `resolveAgentRuntimeUrl` export block:

```ts
export {
  AgentTracer,
  type AgentTraceEnvelope,
  type AgentTraceEventDetail,
} from './agent-tracer';

export { type TraceEmitter, type EmitContext } from './emitters/types';
export { EventBridgeTraceEmitter, type EventBridgeTraceEmitterOptions } from './emitters/eventbridge-emitter';
export { NoopTraceEmitter } from './emitters/noop-emitter';
```

- [ ] **Step 2: Typecheck**

Run: `pnpm nx typecheck agent-orchestrator`
Expected: pass.

- [ ] **Step 3: Lint**

Run: `pnpm nx lint agent-orchestrator`
Expected: pass.

- [ ] **Step 4: Verify existing consumers still build**

Run: `pnpm nx affected -t build --base=main`
Expected: every affected project builds.

> `--base=main` (not `HEAD~1`) — by this point Phase 1 has produced ~6 commits on the branch, so `HEAD~1` would compare to one of our own commits, not to the pre-branch baseline.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): export AgentTracer, TraceEmitter and emitters"
```

---

# Phase 2 — TS path aliases + spec correction

**Shippable outcome:** `tsconfig.base.json` gains the four missing path aliases, and the design spec is updated to match what Plan 1 actually ships (so nobody reads the spec and implements the wrong envelope shape in Plan 2/3). No helper code lands yet — the `AgentTraceTrap` class ships in Plan 2/3 alongside the first agent that needs it (narrative). This avoids the chicken-and-egg problem where the helper imports event constants from services that haven't declared them yet.

**Files:**
- Modify: `tsconfig.base.json`
- Modify: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`

## Task 2.1 — Add missing path aliases

**Settled assumptions for Plan 2/3 (verified against `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`):**

- The method is **`deploy`**, not `init`. (The spec uses `trap.init(...)` in §2 and §9 — that's a doc bug; Task 2.2 below corrects it.)
- `deploy({ bus, detailType })` accepts:
  - `bus`: **short domain label** (`'advisory'` / `'investor'`). Internally resolved via `ctx.ssm.busArn(params.bus)` at fixture line 41. So Plan 2/3's `AGENT_TRACE_EVENTS` map carries short labels — no `NESTFOLIO_INTEG_PREFIX` threading needed.
  - `detailType`: `string | string[]`. Accepts the branded `EventName` produced by `eventName(...)` (string-compatible).
- The EB rule's event pattern filters on `detail.context.tenantId` (lines 70–76) — this is why the emitter wraps `tenantId` under `context` (see Task 1.4 Step 3 and the Known deviations section below).

- [ ] **Step 1: Sanity-check the assumptions still hold**

Run (takes seconds):
```bash
grep -n "async deploy\|ssm.busArn\|context:\s*$\|tenantId:" libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
```

Confirm the method is still named `deploy`, still calls `ctx.ssm.busArn(params.bus)`, and still filters on `detail.context.tenantId`. If any of these three have drifted since 2026-04-19, STOP and update this plan + Plan 2/3 before proceeding — the helper design depends on all three.

- [ ] **Step 2: Inspect current aliases AND verify Plan 3's two pre-assumed aliases exist**

Run: `grep -n '"@nestfolio/' tsconfig.base.json | head -80`

This step adds aliases for advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, onboarding-bff (Step 3). Plan 3 ALSO imports from `@nestfolio/portfolio-engine-ctrl/events` (Task 4.4 Step 1) and `@nestfolio/advisory-ctrl/events` (Task 6.4 Step 1) — the plan assumes those two aliases already exist. Confirm:

```bash
grep -n '"@nestfolio/portfolio-engine-ctrl/events"\|"@nestfolio/advisory-ctrl/events"' tsconfig.base.json
```

Expected: BOTH aliases present (verified on 2026-04-19: `advisory-ctrl/events` at line 43, `portfolio-engine-ctrl/events` at line 62). If either is missing, ADD it in Step 3 alongside the four new ones — otherwise Plan 3 will fail to typecheck `apps/e2e-feature-tests`.

- [ ] **Step 3: Add the four missing entries**

In `tsconfig.base.json`, inside `compilerOptions.paths`, add (adjacent to existing `/events` aliases):

```json
"@nestfolio/advisory-narrative-ctrl/events": ["services/advisory/advisory-narrative-ctrl/src/domain/events.ts"],
"@nestfolio/investor-profile-ctrl/events": ["services/advisory/investor-profile-ctrl/src/domain/events.ts"],
"@nestfolio/market-intelligence-ctrl/events": ["services/advisory/market-intelligence-ctrl/src/domain/events.ts"],
"@nestfolio/onboarding-bff/events": ["services/investor/onboarding-bff/src/domain/events.ts"],
```

- [ ] **Step 4: Verify aliases resolve**

Run: `pnpm nx typecheck e2e-feature-tests`
Expected: pass — should still compile because current e2e source doesn't import from those aliases yet.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore(tsconfig): add events path aliases for four agent services"
```

## Task 2.2 — Correct the design spec so it matches what Plan 1 actually ships

The design spec at `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md` has two inaccuracies that would mislead anyone reading it after this plan merges. Fix them here so the spec and the code agree.

- [ ] **Step 1: Fix `AgentTraceEventDetail` in §3 — `tenantId` must be wrapped under `context`**

Open the spec at §3 ("Full emitted event detail"). Replace the flat `tenantId` with the `context.tenantId` wrapping:

```ts
export interface AgentTraceEventDetail {
  context: { tenantId: string };              // wrapping required — EventBusTrap filters on detail.context.tenantId
  correlationId: string;                       // decisionId, profileId, etc. — caller-supplied
  agent: string;                               // 'decision-lifecycle', 'portfolio-engine', etc.
  envelope: AgentTraceEnvelope;
  emittedAt: string;                           // ISO
}
```

- [ ] **Step 2: Fix `EventBridgeTraceEmitter` in §5 — serialised `Detail` must wrap `tenantId`**

In §5, update the `Detail: JSON.stringify({ tenantId: ctx.tenantId, ... })` block to:

```ts
Detail: JSON.stringify({
  context: { tenantId: ctx.tenantId },
  correlationId: ctx.correlationId,
  agent: ctx.agent,
  envelope,
  emittedAt: new Date().toISOString(),
}),
```

- [ ] **Step 3: Fix §2 and §9 — `trap.init(...)` → `trap.deploy(...)`**

The `EventBusTrap` public API is `deploy`, not `init`. In §2's ASCII flow diagram, change `trap.init({bus, detailType})` → `trap.deploy({bus, detailType})`. In §9 (`waitForAgentTraces`), change both `await trap.init(...)` and the nearby comment "EventBusTrap.init() registers cleanup" to reference `deploy` instead. The fixture's cleanup registration happens inside `deploy` — no other behaviour change.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-18-agent-contract-test-design.md
git commit -m "docs(specs): correct agent-contract spec to match Plan 1 emitter shape"
```

---

# Cross-cutting guidance

## Committing cadence

One commit per sub-task as listed. Do not batch. Use conventional commits (`feat`, `test`, `refactor`, `docs`, `chore`) with scope matching the project name.

## What this plan explicitly does NOT do (per spec §14)

- No OTel-native instrumentation.
- No FakeLlm-based stubbed-graph contract tests.
- No baseline/fingerprint drift tests.
- No GraphQL read-model for traces.
- No new library / new Nx target.
- No extension of `libs/event-types` with a cross-service trace event type.
- No CDC pipeline — emission is direct `PutEvents`.

## Corrections carried into the spec (see Task 2.2)

- **Event detail shape wraps `tenantId` in `context`.** Load-bearing, not optional. `libs/event-processor` parsers reject events without `context.tenantId`, and `EventBusTrap`'s EB rule filters on `detail.context.tenantId` (`event-bus-trap.fixture.ts:67-76`). If the emitter used the spec's original flat shape, the trap would never match and every contract test would time out. The `AgentTraceEventDetail` type in `agent-tracer.ts` reflects this, and Task 2.2 updates the spec §3 + §5 to match.
- **`trap.deploy(...)` is the real method** — the spec's `trap.init(...)` in §2 and §9 is a doc bug, corrected in Task 2.2 Step 3.
- **`InvokeOptions` is a discriminated union.** When an `emitter` is passed, `agent` and `correlationId` are required at the type level. Callers that omit the emitter see the original optional shape. Removes the runtime `&&` guard — the union is the guard. (The spec does not describe the TS shape in detail, so no spec edit needed.)
- **`escalatedFromTier` is rank-based.** Spec §4 describes it conceptually as "escalated from" without pinning semantics. Plan 1 fires it only when the current tier strictly outranks the previous one (`haiku < sonnet < opus`), so fallbacks and unknown-tier transitions leave it undefined. This matches the spec's intent (the field is named *escalated*, not *changed*), so no spec edit needed.

## Plan 1 success criteria

- `pnpm nx test agent-orchestrator` green.
- `pnpm nx typecheck agent-orchestrator` green.
- `pnpm nx lint agent-orchestrator` green.
- `pnpm nx affected -t build --base=main` green (existing consumers still build).
- `pnpm nx typecheck e2e-feature-tests` green (aliases resolve).
- New public API exported from `@nestfolio/agent-orchestrator`: `AgentTracer`, `AgentTraceEnvelope`, `AgentTraceEventDetail`, `TraceEmitter`, `EmitContext`, `EventBridgeTraceEmitter`, `EventBridgeTraceEmitterOptions`, `NoopTraceEmitter`, extended `InvokeOptions`.
- `CompiledGraph.invoke` widened to accept `RunnableConfig` (Task 1.5 Step 1).
- `EventBusTrap.deploy` signature re-confirmed (Task 2.1 Step 1).
- Design spec §2 / §3 / §5 / §9 updated to match the shipped emitter shape (Task 2.2).

## Handoff to Plan 2/3

After this plan merges, proceed to `2026-04-19-agent-contract-tests-02-first-rollout.md`. That plan uses the exports from this plan to instrument `advisory-narrative-ctrl` and lands the `AgentTraceTrap` helper class.
