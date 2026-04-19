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
- `test/emitters/noop-emitter.test.ts`
- **Extend** existing `libs/agent-orchestrator/test/invoke-orchestrator.test.ts` in place. Do NOT overwrite — add the new `describe('invokeOrchestrator trace emission', ...)` block.

> Note on layout: libs use flat `test/**` because they have no integration tests. Only services use `test/unit/**` (and `test/integration/**`).

### Modified files in `libs/agent-orchestrator`
- `src/types.ts` — extend `InvokeOptions` with `agent`, `correlationId`, `tenantId`, `emitter`
- `src/invoke-orchestrator.ts` — wire tracer, emit in `finally`
- `src/index.ts` — export new public API
- `package.json` — verify `@aws-sdk/client-eventbridge` present (already used elsewhere in the workspace)

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
- Modify: `libs/agent-orchestrator/src/types.ts`
- Modify: `libs/agent-orchestrator/src/invoke-orchestrator.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`
- Modify: `libs/agent-orchestrator/package.json` (verify `@aws-sdk/client-eventbridge` present; it already is used elsewhere in the workspace)
- Test: `libs/agent-orchestrator/test/agent-tracer.test.ts`
- Test: `libs/agent-orchestrator/test/emitters/eventbridge-emitter.test.ts`
- Test: `libs/agent-orchestrator/test/emitters/noop-emitter.test.ts`
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
    escalatedFromTier?: ModelTier | 'unknown';
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

export class AgentTracer extends BaseCallbackHandler {
  name = 'agent-tracer';

  private readonly startedAtMs = Date.now();
  private readonly llmCalls: AgentTraceEnvelope['llmCalls'] = [];
  private readonly toolCalls: AgentTraceEnvelope['toolCalls'] = [];
  private readonly nodeSequence: AgentTraceEnvelope['nodeSequence'] = [];
  private readonly errors: AgentTraceEnvelope['errors'] = [];
  private readonly pendingLlm = new Map<string, { model: ModelTier | 'unknown'; startedAtMs: number; node?: string }>();
  private readonly pendingTool = new Map<string, { toolName: string; startedAtMs: number; argKeys: string[]; node?: string }>();
  // Keyed by LangChain runId so parallel chain start/end events (portfolio-engine,
  // investor-profile run nodes in parallel) cannot mis-attribute completedAt timestamps.
  private readonly pendingChains = new Map<string, { nodeName: string; startedAt: string }>();
  private currentNode?: string;
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
  const modelId =
    (llm as { kwargs?: { model?: string; modelName?: string; model_id?: string } } | undefined)
      ?.kwargs?.model ??
    (llm as { kwargs?: { model?: string; modelName?: string } } | undefined)?.kwargs?.modelName ??
    (llm as { kwargs?: { model_id?: string } } | undefined)?.kwargs?.model_id ??
    '';
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
  handleChainStart(chain: Serialized, _inputs: unknown, runId: string): void {
    const nodeName = extractNodeName(chain);
    if (!nodeName) return;
    this.currentNode = nodeName;
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

  handleChainError(err: Error, _runId: string): void {
    this.errors.push({ nodeName: this.currentNode, kind: 'chain_error', message: err.message });
  }

  handleLLMStart(llm: Serialized, _prompts: string[], runId: string): void {
    const model = extractModelTier(llm);
    this.pendingLlm.set(runId, { model, startedAtMs: Date.now(), node: this.currentNode });
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const pending = this.pendingLlm.get(runId);
    if (!pending) return;
    this.pendingLlm.delete(runId);
    const rawUsage =
      (output.llmOutput as { tokenUsage?: Record<string, number>; usage?: Record<string, number> } | undefined);
    const usage = rawUsage?.tokenUsage ?? rawUsage?.usage ?? {};
    const escalatedFromTier =
      this.lastTier && pending.model !== this.lastTier ? this.lastTier : undefined;
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

  handleLLMError(err: Error, _runId: string): void {
    this.errors.push({ nodeName: this.currentNode, kind: 'llm_error', message: err.message });
  }

  handleToolStart(tool: Serialized, input: string, runId: string): void {
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
      node: this.currentNode,
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

  it('records escalatedFromTier when successive LLM calls change tier', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'haiku-x' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(2);
    expect(env.llmCalls[1].escalatedFromTier).toBe('haiku');
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

- [ ] **Step 3: Create `test/emitters/noop-emitter.test.ts`**

Content:

```ts
import { NoopTraceEmitter } from '../../src/emitters/noop-emitter';
import type { AgentTraceEnvelope } from '../../src/agent-tracer';

describe('NoopTraceEmitter', () => {
  it('resolves without side-effects', async () => {
    const emitter = new NoopTraceEmitter();
    const envelope = { status: 'success' } as AgentTraceEnvelope;
    await expect(
      emitter.emit(envelope, { tenantId: 't', correlationId: 'c', agent: 'a' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=noop-emitter`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/emitters/ libs/agent-orchestrator/test/emitters/noop-emitter.test.ts
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

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=eventbridge-emitter`
Expected: PASS. If `aws-sdk-client-mock` is not already a dev dep of the project, install via workspace: verify in existing integration-testing tests — `aws-sdk-client-mock` is used across the repo so it should be accessible.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts libs/agent-orchestrator/test/emitters/eventbridge-emitter.test.ts
git commit -m "feat(agent-orchestrator): add EventBridgeTraceEmitter"
```

## Task 1.5 — Extend `InvokeOptions` + `invokeOrchestrator`

- [ ] **Step 1: Extend `InvokeOptions` in `types.ts` using a discriminated union**

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

- [ ] **Step 2: Write failing test extending `invokeOrchestrator` behaviour**

The file `libs/agent-orchestrator/test/invoke-orchestrator.test.ts` already exists. **Extend** it — do NOT overwrite. Add a new `describe('invokeOrchestrator trace emission', ...)` block appended to the existing suite. Keep existing imports; add only what the new block needs:

```ts
import { invokeOrchestrator } from '../src/invoke-orchestrator';
import type { CompiledGraph } from '../src/create-orchestrator';
import type { TraceEmitter } from '../src/emitters/types';
import type { AgentTraceEnvelope } from '../src/agent-tracer';

function makeGraph(result: Record<string, unknown> | Error): CompiledGraph {
  return {
    invoke: jest.fn(async (_input, config) => {
      // honour callbacks signalling by calling chain/llm/tool handlers? Skipped — only the finally-emit path matters here.
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as CompiledGraph;
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

  it('rejects emitter without agent or correlationId at the type level', () => {
    // Compile-time contract: the InvokeOptions union forbids this shape.
    // This block exists to document the intent; it is tested by `pnpm nx typecheck`,
    // not by Jest. Uncommenting should produce a TS error (test intentionally
    // kept as a `.ts-expect-error` assertion in the source file).
    // @ts-expect-error agent and correlationId are required when emitter is set
    const invalid: Parameters<typeof invokeOrchestrator>[2] = { emitter: { emit: async () => {} } };
    expect(invalid).toBeDefined();
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
    const graph = {
      invoke: jest.fn(async (_input, config) => {
        capturedCallbacks = config?.callbacks;
        return { ok: true };
      }),
    } as unknown as CompiledGraph;

    await invokeOrchestrator(graph, {}, { correlationId: 'x', agent: 'a' });

    expect(Array.isArray(capturedCallbacks)).toBe(true);
    expect((capturedCallbacks as any[])[0]?.name).toBe('agent-tracer');
  });
});
```

- [ ] **Step 3: Run test to verify it fails (old invokeOrchestrator doesn't emit or attach callbacks)**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=invoke-orchestrator`
Expected: FAIL — emission tests fail because current implementation ignores `emitter`.

- [ ] **Step 4: Rewrite `invoke-orchestrator.ts` to attach tracer + emit in finally**

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

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm nx test agent-orchestrator -- --testPathPattern=invoke-orchestrator`
Expected: PASS.

- [ ] **Step 6: Run the full library test suite — must stay green**

Run: `pnpm nx test agent-orchestrator`
Expected: all tests pass. Any test calling `invokeOrchestrator` with no `options` must still work (emission skipped when `emitter` is undefined).

- [ ] **Step 7: Commit**

```bash
git add libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/src/invoke-orchestrator.ts libs/agent-orchestrator/test/invoke-orchestrator.test.ts
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

Run: `pnpm nx affected -t build --base=HEAD~1`
Expected: every affected project builds.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): export AgentTracer, TraceEmitter and emitters"
```

---

# Phase 2 — TS path aliases for services that will be referenced in later plans

**Shippable outcome:** `tsconfig.base.json` gains the four missing path aliases. No helper code lands yet — the `AgentTraceTrap` class ships in Plan 2/3 alongside the first agent that needs it (narrative). This avoids the chicken-and-egg problem where the helper imports event constants from services that haven't declared them yet.

**Files:**
- Modify: `tsconfig.base.json`

## Task 2.1 — Add missing path aliases

- [ ] **Step 1: Verify `EventBusTrap.deploy` signature before anything depends on it**

The `AgentTraceTrap.arm()` landing in Plan 2/3 calls `trap.deploy({ bus: <short-label>, detailType })`. That signature assumption must be confirmed up front — if `bus` expects a resolved name (e.g. `${prefix}-advisory-bus`) rather than the short domain label, every helper use will silently fail to collect events.

Run:
```bash
grep -n "deploy" libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
grep -n "bus" libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts | head -40
```

Confirm BEFORE moving on:
- The `deploy` method signature accepts a `bus` parameter.
- Verify what value `bus` actually expects — short domain label (`'advisory'` / `'investor'`) OR a resolved bus name. If resolved-name, update the `AGENT_TRACE_EVENTS` map plan in Plan 2/3 to carry resolved names (likely built from `process.env['NESTFOLIO_INTEG_PREFIX']`) instead of the short labels sketched there.
- Confirm the `detailType` parameter accepts the branded `EventName` string produced by `eventName(...)`.

Capture the findings in a short note appended to this task's commit message. If the signature differs from what the plan assumed, stop and revise Plan 2/3's helper before proceeding.

- [ ] **Step 2: Inspect current aliases**

Run: `grep -n '"@nestfolio/' tsconfig.base.json | head -80`

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

## Known deviations from the spec (carried forward to later plans)

- **Event detail shape wraps `tenantId` in `context`.** Spec §3 declares `AgentTraceEventDetail` with a flat `tenantId: string` at the top level. This plan wraps it as `detail.context.tenantId` because (a) the workspace envelope convention (see `libs/event-processor` parsers) puts tenant identity under `context`, and (b) `EventBusTrap`'s filter matches on `detail.context.tenantId`. The `AgentTraceEventDetail` type in `agent-tracer.ts` is defined accordingly — this document is the authoritative shape. When the full series lands, update `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md` §3 to match so downstream consumers are not misled.
- **`InvokeOptions` is a discriminated union.** When an `emitter` is passed, `agent` and `correlationId` are required at the type level. Callers that omit the emitter see the original optional shape. Removes the runtime `&&` guard — the union is the guard.

## Plan 1 success criteria

- `pnpm nx test agent-orchestrator` green.
- `pnpm nx typecheck agent-orchestrator` green.
- `pnpm nx lint agent-orchestrator` green.
- `pnpm nx affected -t build --base=HEAD~1` green (existing consumers still build).
- `pnpm nx typecheck e2e-feature-tests` green (aliases resolve).
- New public API exported from `@nestfolio/agent-orchestrator`: `AgentTracer`, `AgentTraceEnvelope`, `AgentTraceEventDetail`, `TraceEmitter`, `EmitContext`, `EventBridgeTraceEmitter`, `EventBridgeTraceEmitterOptions`, `NoopTraceEmitter`, extended `InvokeOptions`.
- `EventBusTrap.deploy` signature confirmed (from Task 2.1 Step 1).

## Handoff to Plan 2/3

After this plan merges, proceed to `2026-04-19-agent-contract-tests-02-first-rollout.md`. That plan uses the exports from this plan to instrument `advisory-narrative-ctrl` and lands the `AgentTraceTrap` helper class.
