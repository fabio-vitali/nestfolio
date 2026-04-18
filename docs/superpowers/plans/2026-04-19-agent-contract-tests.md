# Agent Contract Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, process-metadata contract assertions to six agent-invoking e2e scenarios by emitting an `AgentTraceEnvelope` from `invokeOrchestrator` on every agent invocation, then asserting on the emitted events in the existing scenarios.

**Architecture:** A new `AgentTracer` (LangChain callback handler) accumulates process metadata during `graph.invoke`. A `TraceEmitter` interface + `EventBridgeTraceEmitter` implementation publishes an `AgentTraceEnvelope` to the service's domain EventBridge bus. `invokeOrchestrator` wires tracer → emitter in a `finally` block. Each of the 6 agent services declares its own `{SERVICE}_AGENT_INVOCATION_TRACED` event name in `domain/events.ts` and injects an emitter from its `agents/<agent-name>/server.ts`. `apps/e2e-feature-tests` gets a `waitForAgentTraces` helper built on existing `EventBusTrap`. Existing scenarios gain assertion blocks — no new scenarios.

**Tech Stack:** TypeScript 5, LangChain.js (`@langchain/core`), LangGraph.js (`@langchain/langgraph`), AWS SDK v3 (`@aws-sdk/client-eventbridge`), Jest, Nx, CDK v2, AWS AgentCore Runtime.

---

## Source of truth

- Design spec: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- Project conventions: `CLAUDE.md` (tests in `test/`, `pnpm nx` only, events-only inter-service comms)
- Layout prerequisite merged on `main` 2026-04-19 (all six agent services use `agents/<agent-name>/{graph.ts, server.ts, Dockerfile}`)

## Scope

6 services, 2 domains, 6 events, 1 helper, 5 advisory scenarios + 1 investor scenario extended. No new library, no new Nx target, no FakeLlm, no OTel SDK, no GraphQL read-model.

## Rollout order (per spec §11)

1. Phase 1: Core library (`libs/agent-orchestrator`)
2. Phase 2: E2E helper + TS path aliases
3. Phase 3: `advisory-narrative-ctrl` (lowest-risk — single-node, 0 tools)
4. Phase 4: `portfolio-engine-ctrl` (0 tools, parallel nodes)
5. Phase 5: `investor-profile-ctrl` (RAG-only, parallel fan-out)
6. Phase 6: `advisory-ctrl` / `decision-lifecycle` (full tier + 4 tools)
7. Phase 7: `market-intelligence-ctrl`
8. Phase 8: `onboarding-bff` (investor bus, multi-turn, CopilotKit)
9. Phase 9: Cross-phase verification and handoff

Each phase is independently shippable: the library work in Phase 1 adds unused exports, Phase 2 adds an unused helper, and each service phase adds one trace event plus assertions to its own scenarios.

---

## File structure

### New files in `libs/agent-orchestrator`
- `src/agent-tracer.ts` — `AgentTracer` class, `AgentTraceEnvelope` type, `AgentTraceEventDetail` type
- `src/emitters/types.ts` — `TraceEmitter` interface, `EmitContext` type
- `src/emitters/eventbridge-emitter.ts` — `EventBridgeTraceEmitter`
- `src/emitters/noop-emitter.ts` — `NoopTraceEmitter`
- `test/unit/agent-tracer.test.ts`
- `test/unit/emitters/eventbridge-emitter.test.ts`
- `test/unit/emitters/noop-emitter.test.ts`
- `test/unit/invoke-orchestrator.test.ts` (if not already present; otherwise extended)

### Modified files in `libs/agent-orchestrator`
- `src/types.ts` — extend `InvokeOptions` with `agent`, `correlationId`, `tenantId`, `emitter`
- `src/invoke-orchestrator.ts` — wire tracer, emit in `finally`
- `src/index.ts` — export new public API
- `package.json` — add `@aws-sdk/client-eventbridge` dep (verify not already present)

### New files in `apps/e2e-feature-tests`
- `src/helpers/agent-trace.ts` — `AGENT_TRACE_EVENTS` map, `waitForAgentTraces`, types

### Modified files in `apps/e2e-feature-tests`
- `src/advisory/view-decision-explanation.e2e.test.ts` — narrative contract block
- `src/advisory/rebalance-on-drift.e2e.test.ts` — portfolio-engine contract block
- `src/advisory/first-decision.e2e.test.ts` — decision-lifecycle contract block
- `src/advisory/operating-mode-authority.e2e.test.ts` — decision-lifecycle contract block
- `src/advisory/reconciliation-correction.e2e.test.ts` — decision-lifecycle contract block
- (scenarios for investor-profile, market-intelligence, onboarding — confirmed per-phase)

### Modified files in services
For each of the six services:
- `src/domain/events.ts` — add `{SERVICE}_AGENT_INVOCATION_TRACED` entry
- `agents/<agent-name>/server.ts` — build emitter, pass to `invokeOrchestrator`
- `agents/<agent-name>/graph.ts` — ensure invocation goes through `invokeOrchestrator` (narrative, market-intelligence need single-node StateGraph wrapper)
- `src/service.stack.ts` — `bus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)`

### Modified repo-root files
- `tsconfig.base.json` — add missing `@nestfolio/{advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,onboarding-bff}/events` path aliases

---

## Testing strategy overview

Three test layers:

1. **Unit tests** (`libs/agent-orchestrator/test/unit/*`): AgentTracer isolated from LangChain — drive the handler methods directly, assert envelope shape. EventBridgeTraceEmitter with mocked `EventBridgeClient`. invokeOrchestrator with injected `NoopTraceEmitter` spy + fake graph.
2. **Service unit tests** (`services/<svc>/test/unit/*`): verify server wiring (emitter constructed with correct `detailType`, env var plumbed), not behaviour.
3. **E2E** (`apps/e2e-feature-tests`): existing scenarios plus helper invocation; the trace event materialises on EB after the real deployed agent runs.

`test-support` and `integration-testing` are NOT extended — reuse `EventBusTrap`, `TestContext`, `OrphanReaper` as-is.

## Verification commands reference

- Build one project: `pnpm nx build <project>`
- Unit test one project: `pnpm nx test <project>`
- Unit test with watch: `pnpm nx test <project> --watch`
- Typecheck: `pnpm nx typecheck <project>` or `pnpm nx run-many -t typecheck`
- Lint: `pnpm nx lint <project>`
- Affected: `pnpm nx affected -t test,build,lint`
- Deploy sandbox single service: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<svc>`
- E2E run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`

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
- Test: `libs/agent-orchestrator/test/unit/agent-tracer.test.ts`
- Test: `libs/agent-orchestrator/test/unit/emitters/eventbridge-emitter.test.ts`
- Test: `libs/agent-orchestrator/test/unit/emitters/noop-emitter.test.ts`
- Test: `libs/agent-orchestrator/test/unit/invoke-orchestrator.test.ts`

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
    'gen_ai.request.model': ModelTier;
    'gen_ai.usage.input_tokens': number;
    'gen_ai.usage.output_tokens': number;
    'gen_ai.operation.name': 'chat';
    latencyMs: number;
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
  tenantId: string;
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
  private readonly pendingLlm = new Map<string, { model: ModelTier; startedAtMs: number; node?: string }>();
  private readonly pendingTool = new Map<string, { toolName: string; startedAtMs: number; argKeys: string[]; node?: string }>();
  private currentNode?: string;
  private lastTier?: ModelTier;

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

export function extractModelTier(llm: Serialized | undefined): ModelTier {
  const modelId =
    (llm as { kwargs?: { model?: string; modelName?: string; model_id?: string } } | undefined)
      ?.kwargs?.model ??
    (llm as { kwargs?: { model?: string; modelName?: string } } | undefined)?.kwargs?.modelName ??
    (llm as { kwargs?: { model_id?: string } } | undefined)?.kwargs?.model_id ??
    '';
  if (/haiku/i.test(modelId)) return 'haiku';
  if (/opus/i.test(modelId)) return 'opus';
  return 'sonnet';
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

Content for `libs/agent-orchestrator/test/unit/agent-tracer.test.ts`:

```ts
import { AgentTracer, extractNodeName, extractModelTier, extractToolName } from '../../src/agent-tracer';

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
    expect(extractModelTier({ kwargs: {} } as any)).toBe('sonnet');
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
git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/test/unit/agent-tracer.test.ts
git commit -m "feat(agent-orchestrator): add AgentTracer skeleton and envelope types"
```

## Task 1.2 — AgentTracer LangChain callbacks

- [ ] **Step 1: Extend `AgentTracer` with all LangChain lifecycle handlers**

Append the following methods to the `AgentTracer` class in `libs/agent-orchestrator/src/agent-tracer.ts` (before `build()`):

```ts
  handleChainStart(chain: Serialized, _inputs: unknown, _runId: string): void {
    const nodeName = extractNodeName(chain);
    if (!nodeName) return;
    this.currentNode = nodeName;
    this.nodeSequence.push({ nodeName, startedAt: new Date().toISOString(), completedAt: '' });
  }

  handleChainEnd(_outputs: unknown, _runId: string): void {
    const last = this.nodeSequence[this.nodeSequence.length - 1];
    if (last && !last.completedAt) last.completedAt = new Date().toISOString();
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

Append to `libs/agent-orchestrator/test/unit/agent-tracer.test.ts`:

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
git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/test/unit/agent-tracer.test.ts
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

- [ ] **Step 3: Create `test/unit/emitters/noop-emitter.test.ts`**

Content:

```ts
import { NoopTraceEmitter } from '../../../src/emitters/noop-emitter';
import type { AgentTraceEnvelope } from '../../../src/agent-tracer';

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
git add libs/agent-orchestrator/src/emitters/ libs/agent-orchestrator/test/unit/emitters/noop-emitter.test.ts
git commit -m "feat(agent-orchestrator): add TraceEmitter interface and NoopTraceEmitter"
```

## Task 1.4 — EventBridgeTraceEmitter

- [ ] **Step 1: Write failing test for EventBridgeTraceEmitter**

Content for `libs/agent-orchestrator/test/unit/emitters/eventbridge-emitter.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventName } from '@nestfolio/event-types';
import { EventBridgeTraceEmitter } from '../../../src/emitters/eventbridge-emitter';
import type { AgentTraceEnvelope } from '../../../src/agent-tracer';

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
    expect(detail.tenantId).toBe('tenant-1');
    expect(detail.correlationId).toBe('decision-1');
    expect(detail.agent).toBe('decision-lifecycle');
    expect(detail.envelope).toEqual(baseEnvelope);
    expect(new Date(detail.emittedAt).toString()).not.toBe('Invalid Date');
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
  busName: string;
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
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: this.opts.source,
            DetailType: this.opts.detailType,
            EventBusName: this.opts.busName,
            Detail: JSON.stringify({
              tenantId: ctx.tenantId,
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
git add libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts libs/agent-orchestrator/test/unit/emitters/eventbridge-emitter.test.ts
git commit -m "feat(agent-orchestrator): add EventBridgeTraceEmitter"
```

## Task 1.5 — Extend `InvokeOptions` + `invokeOrchestrator`

- [ ] **Step 1: Extend `InvokeOptions` in `types.ts`**

Modify `libs/agent-orchestrator/src/types.ts`. Replace the existing `InvokeOptions` interface with:

```ts
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Metrics } from '@aws-lambda-powertools/metrics';
import type { TraceEmitter } from './emitters/types';

// ...existing types unchanged...

export interface InvokeOptions {
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  readonly agent?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly emitter?: TraceEmitter;
}
```

Note: current `InvokeOptions` uses `unknown` for `logger`/`metrics`; upgrade to the concrete types from Powertools to preserve compile-time typing when tests pass real instances. Remove the `unknown` aliases.

- [ ] **Step 2: Write failing test extending `invokeOrchestrator` behaviour**

Create `libs/agent-orchestrator/test/unit/invoke-orchestrator.test.ts`:

```ts
import { invokeOrchestrator } from '../../src/invoke-orchestrator';
import type { CompiledGraph } from '../../src/create-orchestrator';
import type { TraceEmitter } from '../../src/emitters/types';
import type { AgentTraceEnvelope } from '../../src/agent-tracer';

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
    const out = await invokeOrchestrator(graph, {}, { correlationId: 'x', agent: 'a' });
    expect(out).toEqual({ ok: true });
  });

  it('skips emission when correlationId is absent', async () => {
    const emit = jest.fn();
    const graph = makeGraph({ ok: true });
    await invokeOrchestrator(graph, {}, { emitter: { emit } as TraceEmitter, agent: 'a' });
    expect(emit).not.toHaveBeenCalled();
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
    if (options?.emitter && options.correlationId && options.agent) {
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
git add libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/src/invoke-orchestrator.ts libs/agent-orchestrator/test/unit/invoke-orchestrator.test.ts
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

# Phase 2 — E2E helper + TS path aliases

**Shippable outcome:** `apps/e2e-feature-tests` gains `waitForAgentTraces` helper and the four missing tsconfig path aliases. Helper is unused by any scenario yet.

**Files:**
- Modify: `tsconfig.base.json`
- Create: `apps/e2e-feature-tests/src/helpers/agent-trace.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/index.ts` (if it exists; otherwise re-export from `src/index.ts` — verify which pattern is used)

## Task 2.1 — Add missing path aliases

- [ ] **Step 1: Inspect current aliases**

Run: `grep -n '"@nestfolio/' tsconfig.base.json | head -80`

- [ ] **Step 2: Add the four missing entries**

In `tsconfig.base.json`, inside `compilerOptions.paths`, add (adjacent to existing `/events` aliases):

```json
"@nestfolio/advisory-narrative-ctrl/events": ["services/advisory/advisory-narrative-ctrl/src/domain/events.ts"],
"@nestfolio/investor-profile-ctrl/events": ["services/advisory/investor-profile-ctrl/src/domain/events.ts"],
"@nestfolio/market-intelligence-ctrl/events": ["services/advisory/market-intelligence-ctrl/src/domain/events.ts"],
"@nestfolio/onboarding-bff/events": ["services/investor/onboarding-bff/src/domain/events.ts"],
```

- [ ] **Step 3: Verify aliases resolve**

Run: `pnpm nx typecheck e2e-feature-tests`
Expected: pass — should still compile because current e2e source doesn't import from those aliases yet.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore(tsconfig): add events path aliases for four agent services"
```

## Task 2.2 — Write failing helper test

- [ ] **Step 1: Confirm file placement for e2e helper tests**

Run: `ls apps/e2e-feature-tests/test 2>/dev/null || echo "no test dir"`
If absent, the e2e app has no unit test target. In that case, test the helper indirectly via a service-side scenario; the first scenario exercise in Phase 3 substitutes for this unit test.

Otherwise create `apps/e2e-feature-tests/test/unit/agent-trace.test.ts` as below.

- [ ] **Step 2: Skip or write unit test based on step 1**

If no unit test target exists, skip to Task 2.3. Otherwise:

```ts
import { AGENT_TRACE_EVENTS } from '../../src/helpers/agent-trace';

describe('AGENT_TRACE_EVENTS map', () => {
  it('has a record for each of the six agents', () => {
    const keys = Object.keys(AGENT_TRACE_EVENTS).sort();
    expect(keys).toEqual([
      'advisoryNarrative',
      'decisionLifecycle',
      'investorProfile',
      'marketIntelligence',
      'onboarding',
      'portfolioEngine',
    ]);
  });

  it('routes onboarding to the investor bus; all others to advisory', () => {
    expect(AGENT_TRACE_EVENTS.onboarding.bus).toBe('investor');
    const advisoryKeys: Array<keyof typeof AGENT_TRACE_EVENTS> = [
      'decisionLifecycle',
      'portfolioEngine',
      'advisoryNarrative',
      'investorProfile',
      'marketIntelligence',
    ];
    for (const key of advisoryKeys) {
      expect(AGENT_TRACE_EVENTS[key].bus).toBe('advisory');
    }
  });
});
```

## Task 2.3 — Implement `agent-trace.ts` helper

- [ ] **Step 1: Create the helper**

Content for `apps/e2e-feature-tests/src/helpers/agent-trace.ts`:

```ts
import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEnvelope } from '@nestfolio/agent-orchestrator';

import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { AdvisoryNarrativeCtrlEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';
import { InvestorProfileCtrlEventTypes } from '@nestfolio/investor-profile-ctrl/events';
import { MarketIntelligenceCtrlEventTypes } from '@nestfolio/market-intelligence-ctrl/events';
import { OnboardingBffEventTypes } from '@nestfolio/onboarding-bff/events';
import { PortfolioEngineCtrlEventTypes } from '@nestfolio/portfolio-engine-ctrl/events';

export const AGENT_TRACE_EVENTS = {
  decisionLifecycle: {
    bus: 'advisory',
    detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
  },
  portfolioEngine: {
    bus: 'advisory',
    detailType: PortfolioEngineCtrlEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
  },
  advisoryNarrative: {
    bus: 'advisory',
    detailType: AdvisoryNarrativeCtrlEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
  investorProfile: {
    bus: 'advisory',
    detailType: InvestorProfileCtrlEventTypes.INVESTOR_PROFILE_AGENT_INVOCATION_TRACED,
  },
  marketIntelligence: {
    bus: 'advisory',
    detailType: MarketIntelligenceCtrlEventTypes.MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED,
  },
  onboarding: {
    bus: 'investor',
    detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
  },
} as const;

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

export interface AgentTraceEvent {
  tenantId: string;
  correlationId: string;
  agent: string;
  envelope: AgentTraceEnvelope;
  emittedAt: string;
}

export interface WaitForAgentTracesOptions {
  agent: AgentKey;
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function waitForAgentTraces(
  ctx: TestContext,
  opts: WaitForAgentTracesOptions,
): Promise<AgentTraceEvent[]> {
  const { bus, detailType } = AGENT_TRACE_EVENTS[opts.agent];
  const minCount = opts.minCount ?? 1;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;

  const trap = new EventBusTrap(ctx);
  await trap.deploy({ bus, detailType });

  const deadline = Date.now() + timeoutMs;
  const collected: AgentTraceEvent[] = [];

  while (Date.now() < deadline) {
    const events = await trap.drain();
    for (const e of events) {
      if (e.detailType !== detailType) continue;
      const detail = e.detail as unknown as AgentTraceEvent;
      if (detail.correlationId === opts.correlationId) {
        collected.push(detail);
      }
    }
    if (collected.length >= minCount) return collected;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `waitForAgentTraces timed out after ${timeoutMs}ms. ` +
      `agent=${opts.agent} correlationId=${opts.correlationId} expected>=${minCount} got=${collected.length}`,
  );
}
```

> Important: this helper calls `trap.deploy(...)` (the actual `EventBusTrap` API), not `trap.init(...)` — the spec's pseudocode used `init` as shorthand; in code we use the real method. Also: `trap.deploy()` already registers a cleanup with `ctx.cleanup`, so the scenario's `afterEach(ctx.cleanup.runAll)` tears the trap down.

- [ ] **Step 2: Re-export helper from the e2e barrel if one exists**

Run: `grep -n "export" apps/e2e-feature-tests/src/index.ts | head -10`

If `apps/e2e-feature-tests/src/index.ts` re-exports helpers, add:

```ts
export { AGENT_TRACE_EVENTS, waitForAgentTraces, type AgentKey, type AgentTraceEvent, type WaitForAgentTracesOptions } from './helpers/agent-trace';
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm nx typecheck e2e-feature-tests && pnpm nx lint e2e-feature-tests`
Expected: both pass.

> Expected failure mode: missing `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED` on `AdvisoryCtrlEventTypes` (and similar on the other 5) until their respective Phase 3–8 tasks add the event. Resolution: these imports will compile on a fresh checkout only after the per-service phase lands the event constant. The plan therefore has two options at this point:

> **Option A (recommended):** defer creating the helper until Phase 3 is underway — lift the helper into Phase 3 as a preliminary step that lands the event on advisory-narrative-ctrl + the helper stub with only one AgentKey, then widen the helper each subsequent phase.

> **Option B:** temporarily type-assert a placeholder detailType for the five pending services. This keeps the helper shape stable but introduces dead imports.

> **Decision: Option A.** The plan below uses Option A. Therefore Task 2.3 is _split_: the helper is initially scaffolded with ONLY the advisory-narrative entry, and each subsequent service phase widens the `AGENT_TRACE_EVENTS` map. The task order is updated accordingly.

- [ ] **Step 4: Replace the full helper with a narrative-only scaffold**

Rewrite `apps/e2e-feature-tests/src/helpers/agent-trace.ts` to contain **only** the `advisoryNarrative` entry in `AGENT_TRACE_EVENTS`. Leave the signature of `waitForAgentTraces` unchanged; but `AgentKey` will initially be the literal type `'advisoryNarrative'`. Each subsequent service phase (Phases 4–8) adds one entry.

- [ ] **Step 5: Defer typecheck + lint + commit to Phase 3**

The helper depends on `AdvisoryNarrativeCtrlEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED`, which is created in Phase 3 Task 3.1. Commit this helper scaffold as part of Phase 3 Task 3.5 together with the narrative event declaration.

---

# Phase 3 — `advisory-narrative-ctrl` (first rollout)

**Shippable outcome:** Narrative agent emits `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` per invocation. `view-decision-explanation.e2e.test.ts` asserts narrative contract. Deployed to sandbox and passing e2e.

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts` (wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`)
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts` (build emitter, pass to invokeOrchestrator)
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` (grant `events:PutEvents` to AgentRuntime execution role)
- Create: `apps/e2e-feature-tests/src/helpers/agent-trace.ts` (narrative-only scaffold from Phase 2.3)
- Modify: `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts` (add assertion block)
- Test: `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` (extend existing if present; otherwise create)

## Task 3.1 — Add event to `domain/events.ts`

- [ ] **Step 1: Open current file**

Run: `cat services/advisory/advisory-narrative-ctrl/src/domain/events.ts`

- [ ] **Step 2: Add the new entry**

In `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`, inside `AdvisoryNarrativeCtrlEventTypes` (or whatever the exported const is actually named — adjust if needed), add:

```ts
ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED: eventName('ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED'),
```

If the file exports a differently-named constant (e.g. `NarrativeEventTypes`), the helper in Phase 2.3 must import under that name — update the helper import statement accordingly.

- [ ] **Step 3: Unit test for event presence**

If a `domain/events.test.ts` exists, append a presence check. Otherwise skip this sub-step (the compile check in the next steps is sufficient).

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/domain/events.ts
git commit -m "feat(advisory-narrative-ctrl): declare ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED event"
```

## Task 3.2 — Refactor graph.ts to route through `invokeOrchestrator`

Narrative currently calls `agentNode({input})` directly — this bypasses `invokeOrchestrator`, so the tracer never attaches. Wrap it in a single-node `StateGraph` so the orchestrator path is uniform.

- [ ] **Step 1: Read current graph.ts**

Run: `cat services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`

- [ ] **Step 2: Replace `invokeNarrative` to build+invoke a compiled graph**

Apply this edit to the `invokeNarrative` function in `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`:

```ts
import { Annotation, StateGraph } from '@langchain/langgraph';
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';

// keep existing imports (buildMemoryClient, buildKBClient, createAgentNode, withFallback, etc.)

const NarrativeState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<Record<string, unknown>>,
});

function buildGraph() {
  const builder = new StateGraph(NarrativeState);
  builder.addNode('advisory-narrative', async (state) => {
    const result = await agentNode({ input: state.input });
    return { output: result as Record<string, unknown> };
  });
  builder.addEdge('__start__', 'advisory-narrative');
  builder.addEdge('advisory-narrative', '__end__');
  return builder.compile();
}

const compiledGraph = buildGraph();

export async function invokeNarrative(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Read upstream decision context from memory (unchanged)
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream decision context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 2. KB enrichment (unchanged)
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  const enrichedInput = params.input + upstreamContext + kbContext;

  const result = await invokeOrchestrator(compiledGraph, { input: enrichedInput }, {
    agent: 'advisory-narrative',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });

  if ('serviceUnavailable' in result) throw new Error(`Narrative unavailable: ${result.reason}`);
  const output = (result as { output?: Record<string, unknown> }).output ?? {};

  await session.writeAgentOutput(output);
  return output;
}
```

- [ ] **Step 3: Update or create unit test that asserts invokeNarrative calls invokeOrchestrator with emitter**

In `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` (create if missing), add a test that stubs `@nestfolio/agent-orchestrator`'s `invokeOrchestrator` and asserts:

- Called once
- Called with `agent: 'advisory-narrative'`
- Called with `correlationId === params.decisionId`
- Called with `tenantId === params.tenantId`
- Called with an `emitter` that matches the one passed (or a `NoopTraceEmitter` instance when omitted)

Minimal skeleton:

```ts
jest.mock('@nestfolio/agent-orchestrator', () => {
  const actual = jest.requireActual('@nestfolio/agent-orchestrator');
  return { ...actual, invokeOrchestrator: jest.fn(async () => ({ output: { ok: true } })) };
});

import { invokeOrchestrator } from '@nestfolio/agent-orchestrator';
import { invokeNarrative } from '../../agents/advisory-narrative/graph';

describe('invokeNarrative → invokeOrchestrator DI', () => {
  it('passes agent/correlationId/tenantId/emitter through', async () => {
    const emitter = { emit: jest.fn(async () => {}) };
    await invokeNarrative({ tenantId: 't', decisionId: 'd', input: 'hi', emitter });
    expect(invokeOrchestrator).toHaveBeenCalledTimes(1);
    const call = (invokeOrchestrator as jest.Mock).mock.calls[0];
    expect(call[2]).toMatchObject({
      agent: 'advisory-narrative',
      correlationId: 'd',
      tenantId: 't',
      emitter,
    });
  });
});
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm nx test advisory-narrative-ctrl -- --testPathPattern=graph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts
git commit -m "refactor(advisory-narrative-ctrl): route agent through invokeOrchestrator"
```

## Task 3.3 — Wire EventBridge emitter from server.ts

- [ ] **Step 1: Modify server.ts**

Replace `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts`:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { AdvisoryNarrativeCtrlEventTypes } from '../../src/domain/events';
import { invokeNarrative } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME']!,
  source: 'agent-orchestrator@advisory-narrative-ctrl',
  detailType: AdvisoryNarrativeCtrlEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeNarrative({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm nx build advisory-narrative-ctrl`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts
git commit -m "feat(advisory-narrative-ctrl): emit AgentTraceEnvelope from agent runtime"
```

## Task 3.4 — Grant `events:PutEvents` on AgentRuntime execution role

- [ ] **Step 1: Inspect current service.stack.ts**

Run: `cat services/advisory/advisory-narrative-ctrl/src/service.stack.ts`

Note the variable holding the `AgentRuntime` construct (expect something like `const agentRuntime = new AgentRuntime(...)`). If the runtime is assigned without capture, capture it.

- [ ] **Step 2: Grant PutEvents**

In `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`, after the `AgentRuntime` construct is instantiated, add:

```ts
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

If the construct was previously not captured in a variable, refactor to `const agentRuntime = new AgentRuntime(this, 'AgentRuntime', { ... });`.

- [ ] **Step 3: CDK synth — verify the policy statement**

Run: `pnpm nx run advisory-narrative-ctrl:synth` (if such a target exists). Otherwise synth from the infra root per project convention — adjust to the repo's standard synth command.

Expected: synth succeeds. Inspect the synthesised template for an IAM policy statement containing `events:PutEvents` with resource `arn:aws:events:*:*:event-bus/<prefix>-advisory-bus` on the runtime's role.

- [ ] **Step 4: CDK assertion test**

In `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` (or wherever the stack CDK assertions live), add:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';
// ... existing imports & stack setup

it('grants events:PutEvents on the advisory bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'events:PutEvents',
          Effect: 'Allow',
        }),
      ]),
    },
  });
});
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm nx test advisory-narrative-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/service.stack.ts services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(advisory-narrative-ctrl): grant PutEvents on advisory bus to AgentRuntime"
```

## Task 3.5 — Land narrative-only e2e helper scaffold (from Phase 2.3)

- [ ] **Step 1: Create helper**

Write `apps/e2e-feature-tests/src/helpers/agent-trace.ts` containing only the `advisoryNarrative` entry:

```ts
import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEnvelope } from '@nestfolio/agent-orchestrator';
import { AdvisoryNarrativeCtrlEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';

export const AGENT_TRACE_EVENTS = {
  advisoryNarrative: {
    bus: 'advisory',
    detailType: AdvisoryNarrativeCtrlEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
} as const;

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

export interface AgentTraceEvent {
  tenantId: string;
  correlationId: string;
  agent: string;
  envelope: AgentTraceEnvelope;
  emittedAt: string;
}

export interface WaitForAgentTracesOptions {
  agent: AgentKey;
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function waitForAgentTraces(
  ctx: TestContext,
  opts: WaitForAgentTracesOptions,
): Promise<AgentTraceEvent[]> {
  const { bus, detailType } = AGENT_TRACE_EVENTS[opts.agent];
  const minCount = opts.minCount ?? 1;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;

  const trap = new EventBusTrap(ctx);
  await trap.deploy({ bus, detailType });

  const deadline = Date.now() + timeoutMs;
  const collected: AgentTraceEvent[] = [];

  while (Date.now() < deadline) {
    const events = await trap.drain();
    for (const e of events) {
      if (e.detailType !== detailType) continue;
      const detail = e.detail as unknown as AgentTraceEvent;
      if (detail.correlationId === opts.correlationId) collected.push(detail);
    }
    if (collected.length >= minCount) return collected;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(
    `waitForAgentTraces timed out after ${timeoutMs}ms. ` +
      `agent=${opts.agent} correlationId=${opts.correlationId} expected>=${minCount} got=${collected.length}`,
  );
}
```

- [ ] **Step 2: Re-export from e2e barrel if applicable**

If `apps/e2e-feature-tests/src/index.ts` re-exports helpers, add `export * from './helpers/agent-trace';`.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm nx typecheck e2e-feature-tests && pnpm nx lint e2e-feature-tests`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace.ts apps/e2e-feature-tests/src/index.ts
git commit -m "feat(e2e): add waitForAgentTraces helper (narrative-only)"
```

## Task 3.6 — Deploy + e2e assertion

- [ ] **Step 1: Deploy to sandbox**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-narrative-ctrl`
Expected: deploy succeeds; CloudFormation change set includes new IAM policy statement on the runtime role.

- [ ] **Step 2: Add assertion block to `view-decision-explanation.e2e.test.ts`**

Insert inside the `'recordExplanationView returns a ViewReceipt with viewedAt set'` test — between the `waitForGraphQL` call and the `bff.advisory.mutate` call, first deploy the trap (so it is live before any narrative trigger), and after the assertion block, assert on the trace.

Apply this patch to `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts`:

```ts
import { waitForAgentTraces } from '../helpers/agent-trace';
// ...keep existing imports...

// Inside the it() body, right after waitForGraphQL(...) succeeds and BEFORE bff.advisory.mutate(...):
// Narrative contract: assert process metadata on the advisory-narrative agent invocation
// (the narrative runs as part of decision finalisation; correlationId is decisionId).
const traces = await waitForAgentTraces(ctx, {
  agent: 'advisoryNarrative',
  correlationId: decisionId,
  minCount: 1,
});
const envelope = traces[0].envelope;

expect(envelope.status).toBe('success');
expect(envelope.errors).toHaveLength(0);
expect(envelope.toolCalls).toHaveLength(0);
expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
expect(envelope.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(15_000);
```

> Important: the trap must be deployed BEFORE the narrative is triggered. Audit the existing `onboarded()` + `withDecision()` fixture sequence in the `beforeEach` of this test: the narrative likely fires as part of `withDecision` finalisation (the agent runs inside the decision lifecycle). Move the `waitForAgentTraces` call so the trap is deployed BEFORE the action that triggers the agent. If `withDecision` itself triggers the narrative, the trap deployment must move into `beforeEach` after `freshTenant` and BEFORE `applyFixtures`. Audit the fixture chain to confirm — if narrative fires inside `withDecision`, refactor: deploy trap in `beforeEach` first, `await applyFixtures`, then run the assertion block in the test body.

- [ ] **Step 3: Run the scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=view-decision-explanation`
Expected: PASS. If the trap times out, re-check trap ordering vs. fixture.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts
git commit -m "test(e2e): assert advisory-narrative contract in view-decision-explanation scenario"
```

## Task 3.7 — Phase 3 verification

- [ ] **Step 1: Full affected test**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: all pass.

- [ ] **Step 2: Audit service card**

Invoke the `audit-service` skill for `advisory-narrative-ctrl` and regenerate `services/advisory/advisory-narrative-ctrl/CLAUDE.md` if drifted (new event name, new emitter wiring).

- [ ] **Step 3: Commit card if changed**

```bash
git add services/advisory/advisory-narrative-ctrl/CLAUDE.md
git commit -m "docs(advisory-narrative-ctrl): refresh service card for trace event"
```

**Phase 3 success criteria:**
- `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` declared, emitted, subscribed in e2e.
- `view-decision-explanation.e2e.test.ts` passes with contract assertion block.
- No existing scenarios regressed.
- Stack synth emits IAM `events:PutEvents` grant.

---

# Phase 4 — `portfolio-engine-ctrl`

**Shippable outcome:** Portfolio engine emits `PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED` and `rebalance-on-drift.e2e.test.ts` asserts its contract.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/events.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` (pass emitter options to `invokeOrchestrator`)
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts` (build emitter + pass through)
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` (PutEvents grant if not already present)
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace.ts` (widen to include `portfolioEngine`)
- Modify: `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (contract block)

## Task 4.1 — Declare event

- [ ] **Step 1: Check current events file**

Run: `cat services/advisory/portfolio-engine-ctrl/src/domain/events.ts`

- [ ] **Step 2: Add entry**

Inside `PortfolioEngineCtrlEventTypes` (or actual const name — verify and adjust), add:

```ts
PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED: eventName('PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/domain/events.ts
git commit -m "feat(portfolio-engine-ctrl): declare PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED event"
```

## Task 4.2 — Wire emitter in graph + server

- [ ] **Step 1: Extend `invokePortfolioEngine` signature in `agents/portfolio-engine/graph.ts` to accept `emitter?: TraceEmitter`**

Thread the emitter into the existing `invokeOrchestrator(graph, input, {})` call. Replace the options with:

```ts
{
  agent: 'portfolio-engine',
  correlationId: params.decisionId,
  tenantId: params.tenantId,
  emitter: params.emitter ?? new NoopTraceEmitter(),
}
```

Add imports: `import { NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';`

- [ ] **Step 2: Update unit test**

Extend `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` with the same DI pattern as Task 3.2 step 3. Assert `invokeOrchestrator` is called with the right `agent/correlationId/tenantId/emitter`.

- [ ] **Step 3: Modify `agents/portfolio-engine/server.ts`**

Replace with:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { PortfolioEngineCtrlEventTypes } from '../../src/domain/events';
import { invokePortfolioEngine } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME']!,
  source: 'agent-orchestrator@portfolio-engine-ctrl',
  detailType: PortfolioEngineCtrlEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokePortfolioEngine({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('portfolio-engine-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm nx test portfolio-engine-ctrl`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
git commit -m "feat(portfolio-engine-ctrl): emit AgentTraceEnvelope from agent runtime"
```

## Task 4.3 — Stack grant

- [ ] **Step 1: Add `this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)` in `service.stack.ts`**

Same pattern as Task 3.4.

- [ ] **Step 2: Extend CDK assertion test**

Same as Task 3.4 step 4.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(portfolio-engine-ctrl): grant PutEvents on advisory bus to AgentRuntime"
```

## Task 4.4 — Widen helper and assert in scenario

- [ ] **Step 1: Add `portfolioEngine` entry to `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace.ts`**

Add import of `PortfolioEngineCtrlEventTypes` and the map entry (see Phase 2.3 full code for reference).

- [ ] **Step 2: Deploy**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl`
Expected: deploy succeeds.

- [ ] **Step 3: Add assertion to `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`**

Read current test first: `cat apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`.

Inside the scenario, after the drift trigger has been published (so the agent has been invoked), add:

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'portfolioEngine',
  correlationId: decisionId,
  minCount: 1,
});
const envelope = traces[0].envelope;

expect(envelope.status).toBe('success');
expect(envelope.errors).toHaveLength(0);
expect(envelope.toolCalls).toHaveLength(0);
expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);

const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
expect(models.has('opus') || models.has('sonnet')).toBe(true);

expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(45_000);
```

Remember to deploy the trap BEFORE the trigger that invokes the agent. The trap is deployed by `waitForAgentTraces`, but `waitForAgentTraces` drains after-the-fact — the trap is live from the moment `trap.deploy` completes. Therefore call `waitForAgentTraces` BEFORE publishing the drift event, OR split the helper into `armAgentTraceTrap(ctx, agent)` + `waitForAgentTraces(trap, correlationId)`. If the scenario publishes the drift before the assertion block, refactor the test to deploy the trap first.

If a trap-before-trigger split is needed, edit `agent-trace.ts` to expose:

```ts
export async function armAgentTraceTrap(ctx: TestContext, agent: AgentKey): Promise<EventBusTrap> {
  const { bus, detailType } = AGENT_TRACE_EVENTS[agent];
  const trap = new EventBusTrap(ctx);
  await trap.deploy({ bus, detailType });
  return trap;
}

export async function collectAgentTraces(
  trap: EventBusTrap,
  opts: { correlationId: string; detailType: EventName; minCount?: number; timeoutMs?: number; pollIntervalMs?: number },
): Promise<AgentTraceEvent[]> {
  // poll + filter as before
}
```

And keep `waitForAgentTraces` as a convenience that composes both. This split is only required when the scenario publishes the trigger BEFORE the assertion block. Apply per-scenario as needed; audit each scenario during the phase.

- [ ] **Step 4: Run scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=rebalance-on-drift`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace.ts apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts
git commit -m "test(e2e): assert portfolio-engine contract in rebalance-on-drift scenario"
```

## Task 4.5 — Phase 4 verification

- [ ] **Step 1: Affected tests**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: green.

- [ ] **Step 2: Refresh service card**

Use the `audit-service` skill on `portfolio-engine-ctrl`, commit card if drifted.

**Phase 4 success criteria:** identical structure to Phase 3, applied to portfolio-engine.

---

# Phase 5 — `investor-profile-ctrl`

**Shippable outcome:** Investor-profile agent emits trace events; an investor-profile-touching scenario asserts the contract.

**Files (same pattern as Phase 4):**
- Modify: `services/advisory/investor-profile-ctrl/src/domain/events.ts` — add `INVESTOR_PROFILE_AGENT_INVOCATION_TRACED`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts` — pass emitter to `invokeOrchestrator`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts` — build EventBridge emitter
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts` — `events:PutEvents` grant
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace.ts` — add `investorProfile`
- Modify: a scenario that triggers investor-profile (confirm during task 5.4 — likely `first-decision.e2e.test.ts` or a dedicated onboarding scenario; if none exists, defer assertion to Phase 6 when decision-lifecycle triggers investor-profile)

## Task 5.1 — Declare event

- [ ] Same as 3.1 but on `InvestorProfileCtrlEventTypes` with `INVESTOR_PROFILE_AGENT_INVOCATION_TRACED`.

## Task 5.2 — Thread emitter through graph.ts and server.ts

- [ ] Same as 4.2 pattern. `invokeOrchestrator` is already invoked at `agents/investor-profile/graph.ts:83` and `src/agent-service.ts:53` — thread emitter into both call sites. For `agent-service.ts` (the local in-process fallback invoked from the ingress handler), pass a `NoopTraceEmitter` unless the deployed path goes through it (it does not — resolveAgentRuntimeUrl short-circuits to remote runtime). Only the server-runtime path needs the real emitter.

- [ ] Unit tests extended to cover the graph-side emitter DI, same shape as Phase 3 Task 3.2 step 3.

## Task 5.3 — Stack grant

- [ ] Same as 3.4.

## Task 5.4 — Widen helper; identify scenario to assert in

- [ ] **Step 1: Identify scenario**

Run: `grep -rln "investorProfile\|investor-profile\|ProfileCreated\|profileCreated\|INVESTOR_PROFILE" apps/e2e-feature-tests/src/`

If no scenario currently triggers investor-profile, assert via an onboarding scenario in Phase 8 or a dedicated scenario added later. The spec acknowledges this possibility (§10 investor-profile block: "if one exists; otherwise in a dedicated investor-profile scenario added later").

- [ ] **Step 2: If a scenario exists:** add assertion block with the investor-profile assertions from spec §10 (`nodes.size >= 2`, model tier set, 0 tools). **If not:** widen `AGENT_TRACE_EVENTS`, deploy, and defer the assertion block to a later phase — document as a known deferral in the plan's final summary.

- [ ] **Step 3: Commit**

## Task 5.5 — Phase 5 verification

- [ ] Standard: `pnpm nx affected -t test,lint,build`, refresh service card.

**Phase 5 success criteria:**
- Event declared and wired.
- Helper map updated.
- Assertion block landed if a suitable scenario exists; otherwise deferred with a tracking entry in the plan summary.

---

# Phase 6 — `advisory-ctrl` / `decision-lifecycle` (highest-complexity rollout)

**Shippable outcome:** Decision-lifecycle agent emits trace events. Three scenarios (`first-decision`, `operating-mode-authority`, `reconciliation-correction`) assert decision-lifecycle contract.

**Files (same pattern):**
- Modify: `services/advisory/advisory-ctrl/src/domain/events.ts` — add `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts` — pass emitter to `invokeOrchestrator`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts` — build emitter
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts` — `events:PutEvents` grant (the stack already grants PutEvents for tool-publisher Lambda; verify if the AgentRuntime role is currently granted — from the stack line 130–135 there's a manual `PolicyStatement` with `events:PutEvents`; confirm whether that's attached to the runtime role or a tool Lambda. If not runtime, add the grant)
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace.ts` — add `decisionLifecycle`
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`

## Task 6.1 — Declare event

- [ ] Same as 3.1 on `AdvisoryCtrlEventTypes`.

## Task 6.2 — Wire emitter

- [ ] **Step 1: graph.ts threading** — thread emitter into the `invokeOrchestrator` call at `agents/decision-lifecycle/graph.ts:53`.

- [ ] **Step 2: src/services/decision-lifecycle.service.ts** — the local fallback path at line 111 also calls `invokeOrchestrator`. Thread `emitter: new NoopTraceEmitter()` here — the local fallback runs outside the deployed AgentCore runtime, so its traces are irrelevant. Alternative: leave unchanged since the fallback is never taken in sandbox/prod when `AGENT_RUNTIME_URL_PARAM` is set.

- [ ] **Step 3: server.ts** — rewrite per Phase 3 pattern with `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED`.

- [ ] **Step 4: unit tests** — same DI shape as Phase 3 Task 3.2 step 3, covering both the `agents/decision-lifecycle/graph.ts` entry and (if you choose to thread) `decision-lifecycle.service.ts`.

- [ ] **Step 5: Commit.**

## Task 6.3 — Stack grant

- [ ] **Step 1: Check existing grant**

Run: `grep -n "events:PutEvents\|grantPutEventsTo" services/advisory/advisory-ctrl/src/service.stack.ts`

The existing `PolicyStatement` at line 128–135 may already target the runtime role via a different construct. Audit which principal attaches to this policy.

- [ ] **Step 2: If the AgentRuntime role is NOT already granted, add `this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)`.**

- [ ] **Step 3: Extend CDK assertion test — same as 3.4.**

- [ ] **Step 4: Commit.**

## Task 6.4 — Widen helper + assertions in three scenarios

- [ ] **Step 1: Add `decisionLifecycle` entry to helper map.**

- [ ] **Step 2: Deploy advisory-ctrl.**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-ctrl`

- [ ] **Step 3: Add assertion block to `first-decision.e2e.test.ts`**

Following spec §10 decision-lifecycle assertions block. Arm the trap BEFORE the trigger event (likely `USER_CONFIRMED` or similar). If the trigger currently fires inside `applyFixtures`, deploy the trap in `beforeEach` AFTER `freshTenant` but BEFORE `applyFixtures`. Read the test first to determine precisely where the decision-lifecycle agent is invoked.

```ts
import { waitForAgentTraces } from '../helpers/agent-trace';

// Inside the scenario body, after the decision is created/finalised:
const traces = await waitForAgentTraces(ctx, {
  agent: 'decisionLifecycle',
  correlationId: decisionId,
  minCount: 1,
});
const envelope = traces[0].envelope;

expect(envelope.status).toBe('success');
expect(envelope.errors).toHaveLength(0);

const nodes = new Set(envelope.nodeSequence.map((n) => n.nodeName));
expect(
  nodes.has('userGoals') || nodes.has('goalExtraction'),
).toBe(true);
expect(
  nodes.has('portfolioConstruction') || nodes.has('construction'),
).toBe(true);

const toolsCalled = new Set(envelope.toolCalls.map((c) => c.toolName));
expect(toolsCalled.has('portfolio-lookup')).toBe(true);
expect(toolsCalled.has('market-data')).toBe(true);
expect(envelope.toolCalls.every((c) => c.status === 'success')).toBe(true);

for (const call of envelope.llmCalls.filter((l) => l.escalatedFromTier)) {
  expect(['haiku', 'sonnet', 'opus']).toContain(call.escalatedFromTier);
}

expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(60_000);
```

- [ ] **Step 4: Add SAME block (with scenario-specific `correlationId`) to `operating-mode-authority.e2e.test.ts` and `reconciliation-correction.e2e.test.ts`.** Adjust node-name or tool-use expectations per scenario if certain nodes/tools are not exercised in that path. If a scenario legitimately uses a different subset (e.g. reconciliation-correction may not call `portfolio-lookup`), relax the assertion to `toolsCalled.size >= 1` for that scenario and document the difference in a code comment.

- [ ] **Step 5: Run all three scenarios.**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern='first-decision|operating-mode-authority|reconciliation-correction'`
Expected: all three pass.

- [ ] **Step 6: Commit.**

## Task 6.5 — Phase 6 verification

- [ ] Same standard suite as prior phases + refresh service card.

**Phase 6 success criteria:**
- Three scenarios asserting decision-lifecycle contract are green.
- Tool-call set matches each scenario's actual topology.

---

# Phase 7 — `market-intelligence-ctrl`

**Shippable outcome:** Market-intelligence agent emits trace events. A scenario that triggers market-intelligence asserts the baseline contract.

**Pattern:** identical to Phase 3 (`advisory-narrative-ctrl`) because market-intelligence also uses `agentNode` directly and needs the single-node StateGraph wrapper refactor.

**Files (same shape as Phase 3):**
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/events.ts`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts` (wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`)
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace.ts`
- Modify: a scenario that triggers market-intelligence (identify — likely one of the advisory decision scenarios triggers it indirectly; audit during task 7.4)

## Task 7.1 — Declare event

- [ ] Same as 3.1 with `MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED`.

## Task 7.2 — Refactor graph.ts through `invokeOrchestrator`

- [ ] Identical refactor as Task 3.2. Wrap `agentNode` in a single-node StateGraph, invoke via `invokeOrchestrator`, thread emitter from server.ts.

- [ ] Unit tests same shape as Task 3.2 step 3.

## Task 7.3 — Wire server + stack

- [ ] server.ts per Task 3.3 pattern, stack per Task 3.4 pattern.

## Task 7.4 — Identify scenario + assert

- [ ] **Step 1: Find triggering scenario**

Run: `grep -rln "marketIntelligence\|market-intelligence\|MARKET_SIGNAL\|market_signal" apps/e2e-feature-tests/src/`

Market-intelligence likely runs as a sub-step of decision-lifecycle. If it emits a trace event on its own invocation (which it will, via its own agent runtime), the scenario can assert on that trace with the decision's `correlationId`.

- [ ] **Step 2: Add the spec §10 baseline block to the identified scenario.**

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'marketIntelligence',
  correlationId: decisionId,  // or appropriate id
  minCount: 1,
});
const envelope = traces[0].envelope;

expect(envelope.status).toBe('success');
expect(envelope.errors).toHaveLength(0);
expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(30_000);
```

- [ ] **Step 3: Run + commit.**

## Task 7.5 — Phase 7 verification

- [ ] Same standard verification + service card refresh.

**Phase 7 success criteria:** market-intelligence agent emits + assertion block passes.

---

# Phase 8 — `onboarding-bff` (last; investor bus; CopilotKit seam)

**Shippable outcome:** Onboarding agent emits `ONBOARDING_AGENT_INVOCATION_TRACED` per turn on the investor bus. An onboarding scenario asserts the multi-turn contract from spec §10.

**Complication acknowledged in spec:** onboarding routes through CopilotRuntime + LangGraphAgent adapter, NOT through `invokeOrchestrator`. The plan below uses a localised seam that preserves the spec's "emission is a first-class domain event" commitment while fitting CopilotKit.

**Files:**
- Modify: `services/investor/onboarding-bff/src/domain/events.ts`
- Modify: `services/investor/onboarding-bff/agents/onboarding/server.ts`
- Modify: `services/investor/onboarding-bff/agents/onboarding/graph.ts` (attach `AgentTracer` via `graph.withConfig({callbacks})` at compile time)
- Modify: `services/investor/onboarding-bff/src/service.stack.ts` (`events:PutEvents` grant)
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace.ts` (add `onboarding` entry)
- Modify: whichever onboarding scenario fits (likely needs to be added if none exists — audit during 8.5)

## Task 8.1 — Declare event on the onboarding-bff domain/events.ts

- [ ] Add `ONBOARDING_AGENT_INVOCATION_TRACED` under `OnboardingBffEventTypes` (or actual exported const name).

- [ ] Commit.

## Task 8.2 — Add tracer + emitter seam in `server.ts` + `graph.ts`

The design challenge: CopilotRuntime invokes `graph.invoke` internally via the `LangGraphAgent` adapter. We need (a) the tracer attached as a callback, and (b) emission after each turn.

**Approach:** create a fresh `AgentTracer` + `EventBridgeTraceEmitter` per HTTP request. Attach tracer via `graph.withConfig({ callbacks: [tracer] })` before handing the graph to `LangGraphAgent`. After `runtime.process(...)` resolves, emit. Errors from the adapter go through status='error'.

- [ ] **Step 1: Modify `buildOnboardingGraph` in `agents/onboarding/graph.ts`** to accept an optional `tracer: BaseCallbackHandler` and, if present, call `graph.withConfig({ callbacks: [tracer] })` on the compiled graph before returning. Example:

```ts
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

export function buildOnboardingGraph(
  deps: { repo: OnboardingRepository },
  opts?: { tracer?: BaseCallbackHandler },
) {
  // ... existing graph construction unchanged ...
  const compiled = graph.compile();
  return opts?.tracer ? compiled.withConfig({ callbacks: [opts.tracer] }) : compiled;
}
```

- [ ] **Step 2: Modify `agents/onboarding/server.ts`** to instantiate tracer + emitter per request and emit after `runtime.process()`:

```ts
import { AgentTracer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { OnboardingBffEventTypes } from '../../src/domain/events';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME']!,
  source: 'agent-orchestrator@onboarding-bff',
  detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
});

// inside /copilotkit handler:
app.post('/copilotkit', async (c) => {
  const tableName = process.env['TABLE_NAME'] ?? '';
  const repo = new OnboardingRepository(tableName);
  const tenantId = c.req.header('x-tenant-id') ?? '';
  const sessionId = c.req.header('x-session-id') ?? c.req.header('x-user-id') ?? '';

  const tracer = new AgentTracer();
  const graph = buildOnboardingGraph({ repo }, { tracer });

  const runtime = new CopilotRuntime();
  const adapter = new LangGraphAgent({ graph });

  let status: 'success' | 'error' = 'success';
  try {
    return await runtime.process(c.req.raw, adapter);
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    if (sessionId && tenantId) {
      emitter
        .emit(tracer.build(status), { tenantId, correlationId: sessionId, agent: 'onboarding' })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('onboarding trace emit failed', e);
        });
    }
  }
});
```

> This seam IS a deviation from "emission lives in invokeOrchestrator" for the specific case of CopilotKit. It is acceptable because (a) onboarding does not call invokeOrchestrator at all, (b) the tracer still attaches via LangChain callbacks, (c) emission is still gated on `correlationId`/`tenantId` presence, and (d) failures are isolated to a `.catch` warning. Document this deviation in the onboarding-bff service card (Task 8.6).

- [ ] **Step 3: Unit test** — write a test that stubs `CopilotRuntime.process`, verifies the emitter is invoked with `agent: 'onboarding'`, status success, and `correlationId === sessionId` from the header.

- [ ] **Step 4: Run + commit.**

## Task 8.3 — Stack grant

- [ ] Same as 3.4 — `this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)` on the investor bus.

## Task 8.4 — Widen helper

- [ ] Add `onboarding` entry to `AGENT_TRACE_EVENTS` with `bus: 'investor'` (NOT advisory).

## Task 8.5 — Assert in onboarding scenario

- [ ] **Step 1: Identify or add a scenario**

Run: `grep -rln "onboard\|copilotkit" apps/e2e-feature-tests/src/` — if a scenario exists that drives CopilotKit turns, use it. Otherwise, defer the assertion block to a follow-up (document in summary).

- [ ] **Step 2: If a scenario exists, add the spec §10 multi-turn assertion block**

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'onboarding',
  correlationId: onboardingSessionId,
  minCount: 1,
});
const final = traces[traces.length - 1].envelope;

expect(final.status).toBe('success');
expect(final.errors).toHaveLength(0);

const toolNames = new Set(traces.flatMap((t) => t.envelope.toolCalls.map((c) => c.toolName)));
expect(toolNames.has('commit-phase') || toolNames.size >= 1).toBe(true);

expect(final.nodeSequence.length).toBeGreaterThanOrEqual(1);

for (const trace of traces) {
  for (const call of trace.envelope.llmCalls) {
    expect(call['gen_ai.request.model']).toBe('sonnet');
  }
}
```

- [ ] **Step 3: Run + commit.**

## Task 8.6 — Phase 8 verification + service card refresh

- [ ] Standard. Document the CopilotKit seam deviation in `services/investor/onboarding-bff/CLAUDE.md` (one sentence under AgentRuntime section).

**Phase 8 success criteria:**
- Onboarding emits per turn on investor bus.
- Helper map complete; all six services represented.
- Scenario assertion passing OR explicitly deferred with rationale in the plan summary.

---

# Phase 9 — Cross-phase verification and handoff

## Task 9.1 — Full-repo green

- [ ] **Step 1: Full test + build**

Run: `pnpm nx run-many -t test,lint,build,typecheck`
Expected: all pass.

- [ ] **Step 2: Full e2e sweep**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`
Expected: every scenario green.

## Task 9.2 — Verify helper map parity

- [ ] **Step 1: Assertion test** (if unit test target exists on e2e-feature-tests; otherwise skip)

Add a small unit test asserting `AGENT_TRACE_EVENTS` has exactly six keys and each detailType matches the imported event constant (prevents drift).

## Task 9.3 — Update `MEMORY.md` topic file

- [ ] **Step 1: Create topic file** `project_agent_contract_tests.md` describing the feature, events, helper, and which scenarios assert which agent's contract.

- [ ] **Step 2: Add a single line under "Recently Completed Work" in `MEMORY.md`:**

```
- **Agent contract tests** — SHIPPED YYYY-MM-DD: 6 agents emit AgentTraceEnvelope per invocation; 5+ advisory scenarios + 1 onboarding scenario assert process metadata (tools, models, nodes, latency). See `project_agent_contract_tests.md`.
```

- [ ] **Step 3: Commit.**

## Task 9.4 — Regenerate C4 diagrams (optional but recommended)

- [ ] Invoke the `generate-c4-diagrams` skill — the emitter is a new outbound edge from each agent runtime to its domain bus; stage-1 will pick it up if the service stacks changed.

## Task 9.5 — Plan summary / deferrals

- [ ] **Step 1: If any service scenario was deferred (investor-profile, market-intelligence, onboarding if no fitting scenario exists), record the deferrals in `project_agent_contract_tests.md` with a note on how to add them.**

- [ ] **Step 2: Commit the summary.**

**Phase 9 success criteria:**
- All tests green.
- Service cards and MEMORY.md reflect new feature.
- Deferrals (if any) documented.

---

# Cross-cutting guidance

## Committing cadence

One commit per sub-task as listed. Do not batch. Use conventional commits (`feat`, `test`, `refactor`, `docs`, `chore`) with scope matching the project name.

## What the plan explicitly does NOT do (per spec §14)

- No OTel-native instrumentation.
- No FakeLlm-based stubbed-graph contract tests.
- No baseline/fingerprint drift tests.
- No GraphQL read-model for traces.
- No new library / new Nx target.
- No extension of `libs/event-types` with a cross-service trace event type.
- No CDC pipeline — emission is direct `PutEvents`.

## Known deviations from the spec

- **`EventBusTrap.init(...)` in the spec is `trap.deploy(...)` in the codebase.** The plan uses `deploy`.
- **Onboarding-bff emission seam.** The spec's "emission lives in `invokeOrchestrator`" commitment does not fit CopilotRuntime cleanly. The plan localises emission into the CopilotKit request handler (Phase 8 Task 8.2). The tracer still attaches via LangChain callbacks through `graph.withConfig`, so the envelope content is produced identically to the other five services. Document this in the onboarding-bff service card.
- **Narrative + market-intelligence refactor.** Both services currently use `agentNode` directly, not `invokeOrchestrator`. Phase 3 and Phase 7 include small refactors that wrap `agentNode` in a single-node StateGraph so the `invokeOrchestrator` path is uniform. No behaviour change; only plumbing.

## Verification checklist before merge (per service phase)

- [ ] Event constant present in `domain/events.ts`.
- [ ] `server.ts` builds `EventBridgeTraceEmitter` with the correct `detailType`.
- [ ] `agents/<agent-name>/graph.ts` routes through `invokeOrchestrator` with `agent/correlationId/tenantId/emitter`.
- [ ] `service.stack.ts` grants `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`.
- [ ] Unit test asserts emitter DI into `invokeOrchestrator`.
- [ ] CDK assertion test asserts the IAM grant.
- [ ] Helper map widened.
- [ ] At least one e2e scenario asserts the agent's contract; trap deployed before trigger.
- [ ] Deploy succeeds.
- [ ] Scenario passes on sandbox (`--prefix=dev`).
- [ ] Service CLAUDE.md card refreshed.
