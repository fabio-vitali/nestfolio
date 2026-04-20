# Agent Contract Test — Design

**Date:** 2026-04-18
**Status:** Design approved, plan pending. Layout prerequisite (uniform `agents/<agent-name>/` structure across all six services) merged on `main` 2026-04-19.
**Supersedes (as the chosen variant):** [2026-04-18-agentcore-evaluations-design.md](./2026-04-18-agentcore-evaluations-design.md) — Solution B, simplified.

---

## 1. Intent

Extend existing e2e scenarios in `apps/e2e-feature-tests` with **behavioural contract assertions** on agent invocations. Assertions are deterministic checks on process metadata (tools called, models used, node sequence, latency envelope) and explicitly do not judge output quality.

**Non-goals:**
- No quality evaluation (no LLM-judge, no ROUGE/BERTScore, no labeled F1, no human review).
- No separate `libs/agent-evaluation/` library, no new Nx target, no new dataset files.
- No in-process harness. No `FakeLlm` path. No remote-invocation HTTP test runner.

**What this gives us:** every agent-invoking e2e scenario, which already publishes trigger events and asserts on downstream GraphQL state, gains one additional assertion block that verifies the agent's process contract via an `AGENT_INVOCATION_TRACED`-style event emitted by each service.

**Scope — six agents across two domains:**

| Service | Domain | Agent name | Graph location | Server location |
|---|---|---|---|---|
| `advisory-ctrl` | advisory | `decision-lifecycle` | `agents/decision-lifecycle/graph.ts` | `agents/decision-lifecycle/server.ts` |
| `investor-profile-ctrl` | advisory | `investor-profile` | `agents/investor-profile/graph.ts` | `agents/investor-profile/server.ts` |
| `portfolio-engine-ctrl` | advisory | `portfolio-engine` | `agents/portfolio-engine/graph.ts` | `agents/portfolio-engine/server.ts` |
| `advisory-narrative-ctrl` | advisory | `advisory-narrative` | `agents/advisory-narrative/graph.ts` | `agents/advisory-narrative/server.ts` |
| `market-intelligence-ctrl` | advisory | `market-intelligence` | `agents/market-intelligence/graph.ts` | `agents/market-intelligence/server.ts` |
| `onboarding-bff` | **investor** | `onboarding` | `agents/onboarding/graph.ts` | `agents/onboarding/server.ts` |

All six services use a uniform `agents/<agent-name>/{graph.ts, server.ts, Dockerfile}` layout. Onboarding-bff retains additional agent support code under `src/agent/` (tools, prompts, state, router, session) which is referenced by `agents/onboarding/graph.ts`.

> **Layout prerequisite — done.** The uniform layout above was merged on `main` 2026-04-19 via `refactor/normalize-agent-runtime-structure` (9 commits). Per-service moves: `6b5aff21` (investor-profile), `88299e99` (portfolio-engine), `ec2fe625` (advisory-narrative), `f852d6fe` (market-intelligence), `8a7c2d8c` (onboarding-bff). `advisory-ctrl` was already canonical. The `service.stack.ts`, `project.json`, test imports, `CLAUDE.md` cards, and the `create-service` skill template were all updated in the same branch. The contract-test wiring described below can now assume this layout uniformly.

## 2. Architecture overview

Data flow in a single scenario:

```
e2e test                              deployed agent runtime (Lambda)
────────                              ────────────────────────────────
1. trap = new EventBusTrap(ctx)       
   trap.deploy({bus, detailType})     
                                       
2. applyFixtures + publish trigger ─► SF / EB rule ─► agent Lambda
                                                        │
                                                        ├─ invokeOrchestrator(graph, input, {
                                                        │    agent, correlationId, tenantId,
                                                        │    emitter,   // DI
                                                        │  })
                                                        │     │
                                                        │     ├─ attach AgentTracer callback
                                                        │     ├─ graph.invoke(input, {callbacks:[tracer]})
                                                        │     ├─ assemble AgentTraceEnvelope
                                                        │     └─ emitter.emit(envelope, ctx)
                                                        │          (EventBridge PutEvents)
                                                        │
                                                        └─ return response to AgentCore Runtime
                                       
3. trap = await AgentTraceTrap.arm(ctx, agentKey)   // BEFORE the trigger
4. traces = await trap.waitFor({correlationId, minCount})
5. expect(traces[0].envelope).toMatchObject(...)
6. trap teardown via ctx.cleanup (already registered by EventBusTrap)
```

### Component ownership

| Piece | Where it lives | Knows about |
|---|---|---|
| `AgentTracer` callback | `libs/agent-orchestrator/src/agent-tracer.ts` | LangChain callback handler protocol only. No AWS, no event names. |
| `TraceEmitter` interface | `libs/agent-orchestrator/src/emitters/types.ts` | Own interface only. |
| `EventBridgeTraceEmitter` | `libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts` | `@aws-sdk/client-eventbridge`. Takes bus, source, detailType via constructor. |
| `NoopTraceEmitter` (for tests / local) | `libs/agent-orchestrator/src/emitters/noop-emitter.ts` | Nothing. Implements `TraceEmitter` with a no-op. |
| `AgentTraceEnvelope` type | `libs/agent-orchestrator/src/agent-tracer.ts` (exported) | Shared technology type. |
| `invokeOrchestrator` (extended) | `libs/agent-orchestrator/src/invoke-orchestrator.ts` | Wires tracer → emitter. No event names, no bus names. |
| `{SERVICE}_AGENT_INVOCATION_TRACED` event | each `services/.../src/domain/events.ts` | Service-owned. Each service declares its own name. |
| CDK env wiring | each `services/.../src/service.stack.ts` | `EVENT_BUS_NAME`, `SERVICE_NAME` — most services already set these. |
| `AGENT_TRACE_EVENTS` map + `AgentTraceTrap` class | `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` | Imports each service's event catalog. Only place with system-wide view. |
| Per-scenario assertions | existing `*.e2e.test.ts` files under `apps/e2e-feature-tests/src/` | Use helper via short label. |

### What changes vs. what doesn't

**Changes:**
- `libs/agent-orchestrator/` gains `AgentTracer`, `TraceEmitter` interface, `EventBridgeTraceEmitter`, `NoopTraceEmitter`, plus extensions to `invokeOrchestrator`.
- Six agent-emitting services each add one event declaration to their `domain/events.ts` and ~3 lines of wiring in their agent server file (`agents/<agent-name>/server.ts`, uniform across all six services).
- `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` is new (exports the `AgentTraceTrap` class).
- Existing scenarios under `apps/e2e-feature-tests/src/advisory/` gain assertion blocks.

**Does not change:**
- `libs/event-types/` — no catalog of cross-service events added.
- BFF GraphQL schemas / resolvers — no read model for traces.
- `libs/test-support/` — not extended (reuse `EventBusTrap` from `libs/integration-testing`).
- CDK constructs (`agent-runtime.ts`, `egress.ts`, etc.) — no new patterns.
- `agent-server.ts` / `agent-factory.ts` / `resolve-runtime-url.ts` signatures.
- Jest configuration, CI target (`test-e2e-features`).

### Design commitments

1. **Always emit.** No `AGENT_EVAL_MODE` env gate. The event is a legitimate first-class domain event, not a test-only artifact. Prod observability value is real (ops dashboards, future audit).
2. **Process metadata only.** No raw LLM prompt text, no raw LLM output text, no raw tool argument values, no raw tool results. Only shapes (argKeys, resultKeys), model tiers, node names, latencies, counts.
3. **Service-owned event names.** Each emitting service declares its own event name in its own `domain/events.ts`. No cross-service shared event type. The event *shape* (`AgentTraceEnvelope`) is shared infrastructure, the *name* is per-service.
4. **Reuse existing infra.** `EventBusTrap` already exists in `libs/integration-testing` with canary-warmup, dedup-aware consume, and `OrphanReaper` cleanup. No second trap.
5. **Failures in emission never break invocation.** The `invokeOrchestrator` emitter call is wrapped in try/catch that logs a warning; the agent's response is returned regardless.

## 3. `AgentTraceEnvelope` shape

Field names use OpenTelemetry GenAI semantic conventions where applicable (`gen_ai.*`), so future migration to OTel-native observability doesn't require schema rewrites.

```ts
// libs/agent-orchestrator/src/agent-tracer.ts
export interface AgentTraceEnvelope {
  // Invocation timing (OTel-aligned)
  'gen_ai.invocation.started_at': string;     // ISO
  'gen_ai.invocation.completed_at': string;   // ISO
  'gen_ai.invocation.latency_ms': number;
  status: 'success' | 'error';

  // One entry per LLM call, using OTel gen_ai.* semantic conventions
  llmCalls: Array<{
    nodeName: string;
    'gen_ai.request.model': string;            // 'haiku' | 'sonnet' | 'opus' (tier name, not vendor id)
    'gen_ai.usage.input_tokens': number;
    'gen_ai.usage.output_tokens': number;
    'gen_ai.operation.name': 'chat';
    latencyMs: number;
    escalatedFromTier?: 'haiku' | 'sonnet' | 'opus';
  }>;

  // One entry per tool invocation
  toolCalls: Array<{
    nodeName: string;
    toolName: string;
    status: 'success' | 'error';
    latencyMs: number;
    argKeys: string[];                         // names of args passed — shape only, NO values
    resultKeys?: string[];                     // names of fields in result — NO values
  }>;

  // LangGraph node traversal order
  nodeSequence: Array<{
    nodeName: string;
    startedAt: string;
    completedAt: string;
  }>;

  // Errors surfaced during invocation
  errors: Array<{
    nodeName?: string;
    kind: string;                              // 'tool_error' | 'chain_error' | 'llm_error' | ...
    message: string;                           // exception message; no stack, no sensitive content
  }>;
}
```

### Full emitted event detail

```ts
export interface AgentTraceEventDetail {
  context: { tenantId: string };
  correlationId: string;                       // decisionId, profileId, etc. — caller-supplied
  agent: string;                               // 'decision-lifecycle', 'portfolio-engine', etc.
  envelope: AgentTraceEnvelope;
  emittedAt: string;                           // ISO
}
```

Emitted with `Source: 'agent-orchestrator@<service>'`, `DetailType: <SERVICE>_AGENT_INVOCATION_TRACED`, `EventBusName: $EVENT_BUS_NAME`.

## 4. `AgentTracer` — LangChain callback handler

Pure TS, no I/O. Accumulates envelope state by subscribing to LangChain lifecycle events.

```ts
// libs/agent-orchestrator/src/agent-tracer.ts
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';

export class AgentTracer extends BaseCallbackHandler {
  name = 'agent-tracer';

  private startedAt = Date.now();
  private llmCalls: AgentTraceEnvelope['llmCalls'] = [];
  private toolCalls: AgentTraceEnvelope['toolCalls'] = [];
  private nodeSequence: AgentTraceEnvelope['nodeSequence'] = [];
  private errors: AgentTraceEnvelope['errors'] = [];
  private pendingLlmStarts = new Map<string, { model: string; startedAt: number; node?: string }>();
  private pendingToolStarts = new Map<string, { toolName: string; startedAt: number; argKeys: string[]; node?: string }>();
  private currentNode?: string;
  private lastTier?: 'haiku' | 'sonnet' | 'opus';

  handleChainStart(chain: Serialized, _inputs: unknown, _runId: string) {
    const nodeName = extractNodeName(chain);
    if (nodeName) {
      this.currentNode = nodeName;
      this.nodeSequence.push({ nodeName, startedAt: new Date().toISOString(), completedAt: '' });
    }
  }

  handleChainEnd(_outputs: unknown, _runId: string) {
    const last = this.nodeSequence[this.nodeSequence.length - 1];
    if (last && !last.completedAt) last.completedAt = new Date().toISOString();
  }

  handleLLMStart(llm: Serialized, _prompts: string[], runId: string) {
    const model = extractModelTier(llm);
    this.pendingLlmStarts.set(runId, { model, startedAt: Date.now(), node: this.currentNode });
  }

  handleLLMEnd(output: LLMResult, runId: string) {
    const pending = this.pendingLlmStarts.get(runId);
    if (!pending) return;
    this.pendingLlmStarts.delete(runId);
    const usage = (output.llmOutput as any)?.tokenUsage ?? (output.llmOutput as any)?.usage ?? {};
    const escalatedFrom = this.lastTier && pending.model !== this.lastTier ? this.lastTier : undefined;
    this.llmCalls.push({
      nodeName: pending.node ?? 'unknown',
      'gen_ai.request.model': pending.model,
      'gen_ai.usage.input_tokens': usage.input_tokens ?? usage.promptTokens ?? 0,
      'gen_ai.usage.output_tokens': usage.output_tokens ?? usage.completionTokens ?? 0,
      'gen_ai.operation.name': 'chat',
      latencyMs: Date.now() - pending.startedAt,
      escalatedFromTier: escalatedFrom,
    });
    this.lastTier = pending.model as typeof this.lastTier;
  }

  handleToolStart(tool: Serialized, input: string, runId: string) {
    const toolName = extractToolName(tool);
    let argKeys: string[] = [];
    try { argKeys = Object.keys(JSON.parse(input) ?? {}); } catch { /* non-JSON */ }
    this.pendingToolStarts.set(runId, { toolName, startedAt: Date.now(), argKeys, node: this.currentNode });
  }

  handleToolEnd(output: string, runId: string) {
    const pending = this.pendingToolStarts.get(runId);
    if (!pending) return;
    this.pendingToolStarts.delete(runId);
    let resultKeys: string[] | undefined;
    try { resultKeys = Object.keys(JSON.parse(output) ?? {}); } catch { /* non-JSON */ }
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'success',
      latencyMs: Date.now() - pending.startedAt,
      argKeys: pending.argKeys,
      resultKeys,
    });
  }

  handleToolError(err: Error, runId: string) {
    const pending = this.pendingToolStarts.get(runId);
    if (!pending) return;
    this.pendingToolStarts.delete(runId);
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'error',
      latencyMs: Date.now() - pending.startedAt,
      argKeys: pending.argKeys,
    });
    this.errors.push({ nodeName: pending.node, kind: 'tool_error', message: err.message });
  }

  handleChainError(err: Error, _runId: string) {
    this.errors.push({ nodeName: this.currentNode, kind: 'chain_error', message: err.message });
  }

  handleLLMError(err: Error, _runId: string) {
    this.errors.push({ nodeName: this.currentNode, kind: 'llm_error', message: err.message });
  }

  build(status: 'success' | 'error'): AgentTraceEnvelope {
    const completedAt = Date.now();
    return {
      'gen_ai.invocation.started_at': new Date(this.startedAt).toISOString(),
      'gen_ai.invocation.completed_at': new Date(completedAt).toISOString(),
      'gen_ai.invocation.latency_ms': completedAt - this.startedAt,
      status,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      nodeSequence: this.nodeSequence,
      errors: this.errors,
    };
  }
}

// Helpers (implementation detail)
function extractNodeName(chain: Serialized): string | undefined { /* walk chain.kwargs or name */ }
function extractModelTier(llm: Serialized): 'haiku' | 'sonnet' | 'opus' { /* map MODEL_ID_MAP inverse */ }
function extractToolName(tool: Serialized): string { /* tool.name or last id segment */ }
```

## 5. `TraceEmitter` interface and implementations

```ts
// libs/agent-orchestrator/src/emitters/types.ts
export interface EmitContext {
  tenantId: string;
  correlationId: string;
  agent: string;
}

export interface TraceEmitter {
  emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void>;
}
```

### `EventBridgeTraceEmitter`

```ts
// libs/agent-orchestrator/src/emitters/eventbridge-emitter.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventName } from '@nestfolio/event-types';

export class EventBridgeTraceEmitter implements TraceEmitter {
  private readonly client: EventBridgeClient;

  constructor(private readonly opts: {
    busName: string;
    source: string;        // 'agent-orchestrator@<service>'
    detailType: EventName; // service-owned, injected
    region?: string;
  }) {
    this.client = new EventBridgeClient({ region: opts.region ?? 'us-east-1' });
  }

  async emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void> {
    await this.client.send(new PutEventsCommand({
      Entries: [{
        Source: this.opts.source,
        DetailType: this.opts.detailType,
        EventBusName: this.opts.busName,
        Detail: JSON.stringify({
          context: { tenantId: ctx.tenantId },
          correlationId: ctx.correlationId,
          agent: ctx.agent,
          envelope,
          emittedAt: new Date().toISOString(),
        }),
      }],
    }));
  }
}
```

### `NoopTraceEmitter`

For unit tests, local dev, or any environment where emission should be skipped.

```ts
// libs/agent-orchestrator/src/emitters/noop-emitter.ts
export class NoopTraceEmitter implements TraceEmitter {
  async emit(): Promise<void> { /* no-op */ }
}
```

## 6. `invokeOrchestrator` extension

```ts
// libs/agent-orchestrator/src/invoke-orchestrator.ts
export interface InvokeOptions {
  logger?: Logger;
  metrics?: Metrics;
  agent: string;                        // NEW — required
  correlationId?: string;               // NEW — optional; if absent, emission is skipped
  tenantId?: string;                    // NEW
  emitter?: TraceEmitter;               // NEW — DI; if absent, emission is skipped
}

export async function invokeOrchestrator(
  graph: CompiledGraph,
  input: Record<string, unknown>,
  options: InvokeOptions,
): Promise<Record<string, unknown> | ServiceUnavailableResponse> {
  const logger = options.logger ?? defaultLogger;
  const metrics = options.metrics ?? defaultMetrics;
  const tracer = new AgentTracer();
  const startTime = Date.now();
  let status: 'success' | 'error' = 'success';

  try {
    const result = await graph.invoke(input, { callbacks: [tracer] });
    metrics.addMetric('OrchestratorSuccess', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, Date.now() - startTime);
    logger.info('Orchestrator invocation completed', { duration: Date.now() - startTime });
    return result;
  } catch (err) {
    status = 'error';
    metrics.addMetric('OrchestratorFailure', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, Date.now() - startTime);
    logger.error('Orchestrator invocation failed', { err });
    return { serviceUnavailable: true, reason: err instanceof Error ? err.message : 'Unknown error' };
  } finally {
    const envelope = tracer.build(status);
    if (options.emitter && options.correlationId) {
      try {
        await options.emitter.emit(envelope, {
          correlationId: options.correlationId,
          tenantId: options.tenantId ?? '',
          agent: options.agent,
        });
      } catch (emitErr) {
        logger.warn('Trace emission failed', { err: emitErr });
      }
    }
  }
}
```

**Key properties:**
- Emission runs in `finally` — succeeds or fails, the trace tries to go out.
- Emission failure is logged, never propagated. The agent invocation result is unaffected.
- Emission adds ~20–50ms to the handler's response path. Acceptable vs. agent invocation times of 2–10s.
- If `emitter` or `correlationId` is missing, emission is silently skipped (unit tests, local dev).

## 7. Per-service event declarations

Each emitting service declares its own event name alongside its existing domain events:

```ts
// services/advisory/advisory-ctrl/src/domain/events.ts
export const AdvisoryCtrlEventTypes = {
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_PACKET_UPDATED: 'DECISION_PACKET_UPDATED',
  // …existing events…
  DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED: 'DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED',
} as const satisfies Record<string, EventName>;
```

| Service | Domain bus | Event name |
|---|---|---|
| `advisory-ctrl` | advisory | `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED` |
| `portfolio-engine-ctrl` | advisory | `PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED` |
| `advisory-narrative-ctrl` | advisory | `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` |
| `investor-profile-ctrl` | advisory | `INVESTOR_PROFILE_AGENT_INVOCATION_TRACED` |
| `market-intelligence-ctrl` | advisory | `MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED` |
| `onboarding-bff` | investor | `ONBOARDING_AGENT_INVOCATION_TRACED` |

Each event is registered on its service's Egress construct like any other domain event. No CDC-driven emission — the event comes directly from `EventBridgeTraceEmitter.emit()`.

### Note on onboarding-bff

Onboarding-bff is the single agent outside the advisory domain — it emits on the **investor** bus rather than advisory. The event name `ONBOARDING_AGENT_INVOCATION_TRACED` lives in `services/investor/onboarding-bff/src/domain/events.ts` (or the service's existing event-types module) following the same per-service ownership rule.

## 8. Service-side wiring

Each agent service's `agents/<agent-name>/server.ts`:

```ts
// services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeOrchestrator, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { AdvisoryCtrlEventTypes } from '../../src/domain/events';
import { createDecisionLifecycleGraph } from './graph';

const graph = createDecisionLifecycleGraph();

const emitter = new EventBridgeTraceEmitter({
  busName: process.env.EVENT_BUS_NAME!,
  source: 'agent-orchestrator@advisory-ctrl',
  detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const input = JSON.parse(prompt);
  const result = await invokeOrchestrator(graph, input, {
    agent: 'decision-lifecycle',
    correlationId: input.decisionId ?? sessionId,
    tenantId: input.tenantId,
    emitter,
  });
  return JSON.stringify(result);
});

export default app;
```

Consumer footprint: 3 lines to build the emitter, plus 3 option fields on the `invokeOrchestrator` call. No tracing logic in the consumer — just DI of configuration.

### Env vars required at runtime

| Env var | Source | Required |
|---|---|---|
| `EVENT_BUS_NAME` | Service stack `environmentVariables` on `AgentRuntime` | Yes |
| `SERVICE_NAME` | Service stack `environmentVariables` on `AgentRuntime` | No (informational logging) |

All agent-emitting services already set `EVENT_BUS_NAME` for their existing event emission; no new CDK pattern.

### IAM requirement

The AgentCore Runtime's execution role must have `events:PutEvents` on its domain bus. Services that already emit domain events from their runtime have this; services that only consumed events before now need the grant added. Concretely, the plan phase must verify and extend `AgentRuntime` construct wiring in each service stack so `bus.grantPutEventsTo(runtime.grantPrincipal)` is invoked.

## 9. E2E harness — `AgentTraceTrap` class

The harness is a small class that wraps `EventBusTrap`, bound to a single agent key at arm time. This shape mirrors how e2e scenarios actually use it: arm once in `beforeEach`, call `.waitFor({correlationId})` after the trigger. The class replaces the earlier free-function sketch (`waitForAgentTraces`) because:
- Scenarios need to arm BEFORE the trigger runs; a free function that does "deploy then poll" in one call encourages the opposite (deploy after the trigger → miss events).
- Per-agent latency budgets belong with the trap instance, not as a parameter on every `waitFor` call.
- The agent key is static for the life of the scenario; keeping it on the instance eliminates repeated lookup and prevents accidental agent-key typos after the first `arm()`.

```ts
// apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts
import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEventDetail } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';

const AGENT_TRACE_EVENTS = {
  advisoryNarrative: {
    bus: 'advisory' as const,
    detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
  // Additional agent entries are added in Plan 3 as each service opts in.
};

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

const DEFAULT_LATENCY_BUDGETS_MS = {
  advisoryNarrative: 15_000,
  portfolioEngine: 45_000,
  decisionLifecycle: 60_000,
  investorProfile: 30_000,
  marketIntelligence: 30_000,
  onboarding: 30_000,
} as const;

export interface WaitForOptions {
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class AgentTraceTrap<K extends AgentKey> {
  private constructor(
    private readonly trap: EventBusTrap,
    public readonly agent: K,
    private readonly detailType: string,
  ) {}

  /** Arm the trap. Call BEFORE any fixture or action that can invoke the agent. */
  static async arm<K extends AgentKey>(ctx: TestContext, agent: K): Promise<AgentTraceTrap<K>> {
    const entry = AGENT_TRACE_EVENTS[agent];
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: entry.bus, detailType: entry.detailType });
    return new AgentTraceTrap(trap, agent, entry.detailType);
  }

  /** Poll for trace events matching correlationId. */
  async waitFor(opts: WaitForOptions): Promise<AgentTraceEventDetail[]> {
    // drain + filter by detailType and correlationId, poll until minCount (default 1)
    // or timeoutMs (default 60_000). Throws with a hint that .arm() was likely
    // called too late when the timeout fires.
  }

  /** Per-agent soft latency budget in ms; overridable via AGENT_LATENCY_BUDGET_MS_<KEY>. */
  getLatencyBudget(): number { /* returns default or env override */ }
}
```

**Usage pattern (from `view-decision-explanation.e2e.test.ts`):**

```ts
let narrativeTrap: AgentTraceTrap<'advisoryNarrative'>;

beforeEach(async () => {
  ctx = await createTestContext();
  tenant = await freshTenant(ctx);
  // ARM BEFORE applyFixtures — the narrative fires during decision finalisation.
  narrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
  const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision(...)]);
  decisionId = result.decisionId;
});

it('...', async () => {
  // ... trigger + primary assertions ...
  const traces = await narrativeTrap.waitFor({ correlationId: decisionId });
  expect(traces[0].envelope.status).toBe('success');
  expect(traces[0].envelope['gen_ai.invocation.latency_ms'])
    .toBeLessThan(narrativeTrap.getLatencyBudget());
});
```

**Important behaviour notes:**
- `AgentTraceTrap.arm()` must be called **before** the trigger event is published (otherwise the EB rule isn't live when events flow through). In practice that means arming at the top of `beforeEach`, before `applyFixtures` — because fixtures like `withDecision` run the decision cycle synchronously and will invoke the agent.
- `EventBusTrap.deploy()` has built-in canary warmup — it does not return until the EB rule is provably delivering to the SQS queue.
- `ctx.cleanup` (registered by `EventBusTrap.deploy()`) tears down the SQS queue + EB rule at scenario end.
- `OrphanReaper` (in `libs/integration-testing`) cleans up any queues/rules that leak, older than 1 hour.
- The `AGENT_TRACE_EVENTS` map grows one entry at a time as each service rolls in (see §11 Rollout order). Plan 2 adds only `advisoryNarrative`; Plan 3 adds the remaining five.

## 10. Per-agent contract assertions

The actual assertion blocks that go into existing scenarios.

### `decision-lifecycle` (advisory-ctrl)

Opus + Sonnet + Haiku. 4 Gateway tools: `portfolio-lookup`, `market-data`, `instrument-universe`, `event-publisher`. Multi-node graph.

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'decisionLifecycle', correlationId: decisionId, minCount: 1,
});
const t = traces[0].envelope;

expect(t.status).toBe('success');
expect(t.errors).toHaveLength(0);

// Graph traversal
const nodes = new Set(t.nodeSequence.map(n => n.nodeName));
expect(nodes.has('userGoals') || nodes.has('goalExtraction')).toBe(true);
expect(nodes.has('portfolioConstruction') || nodes.has('construction')).toBe(true);

// Tool usage
const toolsCalled = new Set(t.toolCalls.map(c => c.toolName));
expect(toolsCalled.has('portfolio-lookup')).toBe(true);
expect(toolsCalled.has('market-data')).toBe(true);
expect(t.toolCalls.every(c => c.status === 'success')).toBe(true);

// Tier escalation: if any LLM call escalated, the 'from' tier is one of the valid tiers
for (const call of t.llmCalls.filter(l => l.escalatedFromTier)) {
  expect(['haiku', 'sonnet', 'opus']).toContain(call.escalatedFromTier);
}

// Latency envelope
expect(t['gen_ai.invocation.latency_ms']).toBeLessThan(60_000);
```

### `portfolio-engine` (portfolio-engine-ctrl)

Opus + Sonnet. 0 tools. Parallel construction + rebalance nodes.

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'portfolioEngine', correlationId: decisionId, minCount: 1,
});
const t = traces[0].envelope;

expect(t.status).toBe('success');
expect(t.errors).toHaveLength(0);
expect(t.toolCalls).toHaveLength(0);            // contract: zero Gateway tools
expect(t.llmCalls.length).toBeGreaterThanOrEqual(1);

const models = new Set(t.llmCalls.map(l => l['gen_ai.request.model']));
expect(models.has('opus') || models.has('sonnet')).toBe(true);

expect(t['gen_ai.invocation.latency_ms']).toBeLessThan(45_000);
```

### `advisory-narrative` (advisory-narrative-ctrl)

Sonnet. Single-node agent. 0 tools. `narrativeTrap` is armed in `beforeEach` before `applyFixtures`.

```ts
const traces = await narrativeTrap.waitFor({ correlationId: decisionId });
const t = traces[0].envelope;

expect(t.status).toBe('success');
expect(t.errors).toHaveLength(0);
expect(t.toolCalls).toHaveLength(0);
expect(t.llmCalls.length).toBeGreaterThanOrEqual(1);
expect(t.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
expect(t['gen_ai.invocation.latency_ms']).toBeLessThan(narrativeTrap.getLatencyBudget());
```

### `investor-profile` (investor-profile-ctrl)

Opus + Haiku. RAG-only (no Gateway tools). Parallel user-goals + risk-assessment.

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'investorProfile', correlationId: profileId, minCount: 1,
});
const t = traces[0].envelope;

expect(t.status).toBe('success');
expect(t.errors).toHaveLength(0);
expect(t.toolCalls).toHaveLength(0);            // no Gateway tools

const nodes = new Set(t.nodeSequence.map(n => n.nodeName));
expect(nodes.size).toBeGreaterThanOrEqual(2);   // parallel fan-out

const models = new Set(t.llmCalls.map(l => l['gen_ai.request.model']));
expect(models.has('opus') || models.has('haiku')).toBe(true);
```

### `market-intelligence` (market-intelligence-ctrl)

Topology to confirm during plan phase. Baseline invariants:

```ts
const traces = await waitForAgentTraces(ctx, {
  agent: 'marketIntelligence', correlationId, minCount: 1,
});
const t = traces[0].envelope;

expect(t.status).toBe('success');
expect(t.errors).toHaveLength(0);
expect(t.llmCalls.length).toBeGreaterThanOrEqual(1);
expect(t['gen_ai.invocation.latency_ms']).toBeLessThan(30_000);
```

### `onboarding` (onboarding-bff)

Sonnet. 7-phase LangGraph wizard with 4 tools (`search-kb`, `compute-risk`, `render-ui`, `commit-phase`). Multi-turn conversation — each HTTP turn emits its own trace event keyed by the onboarding session / correlationId.

```ts
// In an onboarding-related e2e scenario, correlationId = onboardingSessionId
const traces = await waitForAgentTraces(ctx, {
  agent: 'onboarding', correlationId: onboardingSessionId, minCount: 1,
});
// For multi-turn: minCount = number of turns the scenario drives
const final = traces[traces.length - 1].envelope;

expect(final.status).toBe('success');
expect(final.errors).toHaveLength(0);

// Tool contract: onboarding should use its 4 tools (subset per turn)
const toolNames = new Set(traces.flatMap(t => t.envelope.toolCalls.map(c => c.toolName)));
expect(toolNames.has('commit-phase')).toBe(true);  // at least one commit happened

// Phase progression assertion: node/phase names recorded in sequence
// (exact node names verified during plan phase against src/agent/phase-node.ts)
expect(final.nodeSequence.length).toBeGreaterThanOrEqual(1);

// Every turn uses Sonnet
for (const trace of traces) {
  for (const call of trace.envelope.llmCalls) {
    expect(call['gen_ai.request.model']).toBe('sonnet');
  }
}
```

### Common invariants (applied to every agent)

1. `status === 'success'` for happy-path scenarios.
2. `errors` empty unless scenario explicitly triggers an error.
3. `llmCalls.length >= 1` — agent actually invoked an LLM.
4. `gen_ai.invocation.latency_ms` within agent-specific envelope.
5. Every `toolCalls[*].status === 'success'` unless a tool-failure scenario is being tested.

## 11. Rollout order

**Prerequisite — sandbox pipeline-trigger gap (discovered 2026-04-20 during Plan 2 execution):**
Before any live-path e2e assertion on the five advisory-side agents, `dev-decision-workflow-ctrl-decisionstatemachine` must actually execute when `withLiveDecision` publishes a trigger event. During Plan 2, `aws stepfunctions list-executions` on that SF returned `[]` — `advisory-ctrl` short-circuits the decision packet into advisory-bff without invoking the SF, so `GENERATE_NARRATIVE` (published only from `decision-state-machine.ts:86`) never fires. All five advisory agents depend on the SF firing; closing this gap is the first task of Plan 3 (Phase 3.5) and unblocks the live assertions in the phases below.

Services are instrumented one at a time; one PR per service, ordered lowest-risk-first so the pattern hardens against real cases before the most complex agents are touched.

1. **`advisory-narrative-ctrl`** — single-node, 0 tools, shortest graph. Proves `AgentTracer` + emitter wiring end-to-end. **Live assertion originally planned for `view-decision-explanation.e2e.test.ts` was deferred** (that scenario uses the synthetic `withDecision` fixture and does not invoke the narrative agent). After the Phase 3.5 pipeline fix, the assertion lands in `first-decision.e2e.test.ts` alongside the other advisory agents — see Plan 3 Phase 7.5.
2. **`portfolio-engine-ctrl`** — 0 tools, parallel-node topology. Validates `nodeSequence` capture across parallel branches. Asserted in `rebalance-on-drift.e2e.test.ts`.
3. **`investor-profile-ctrl`** — RAG-only, parallel fan-out. Validates that retriever-driven invocations produce well-formed envelopes. Asserted in the onboarding-related scenario (if one exists; otherwise in a dedicated investor-profile scenario added later).
4. **`advisory-ctrl/decision-lifecycle`** — full multi-tier + 4 tools. Asserted in `first-decision.e2e.test.ts`, `operating-mode-authority.e2e.test.ts`, `reconciliation-correction.e2e.test.ts`.
5. **`market-intelligence-ctrl`** — asserted once its exact graph topology is confirmed; pattern is the same as advisory-narrative (single agent).
6. **`onboarding-bff`** — last, because it's the only agent on the investor bus and it's multi-turn. Doing it last lets us reuse the settled pattern from all five advisory-side rollouts.

## 12. CI and cost

**CI:** unchanged. Same Nx target (`test-e2e-features`), same Jest runner, same cadence. `nx affected` continues to scope runs by changed projects — if advisory-ctrl changes, only advisory-ctrl scenarios rerun.

**Cost delta per agent invocation:**
- 1 extra EventBridge `PutEvents` call. At $1/million events, negligible.
- Per scenario: 1 `EventBusTrap` (SQS queue + EB rule create + delete). Already the standard cost profile of existing integration tests using `EventBusTrap`.
- Zero extra Bedrock LLM calls. The LLM is invoked once by the agent in either case.

**No new cost dimensions introduced.**

## 13. Escape hatch — what this design does not catch

This design intentionally ignores semantic quality. If the LLM starts generating structurally valid but substantively bad output (e.g., portfolios that technically sum to 1 but are mis-allocated), tests will pass.

Mitigations in place:

1. **Downstream GraphQL assertions remain authoritative.** Existing scenarios already assert on projected BFF state (decision packet status `READY`, weights present, etc.). Severe LLM breakdown produces malformed downstream state, and those assertions fail.
2. **Prod observability via the trace event.** Since emission is always-on, production can tap the same events for dashboards (latency drift, unusual model-tier mix, tool-call pattern shifts). Not part of v1 scope but the data is there to build on.
3. **Manual spot-checks.** Retained as a human-gated step when `MODEL_ID_MAP` or prompt templates change materially.
4. **Additive path to real eval.** If semantic evaluation ever becomes a priority, the full in-repo harness from the earlier Solution B (quality metrics, LLM-judge, baselines) is additive — it would consume the same trace events and layer scoring on top. No part of this design blocks that.

## 14. Out of scope

- **OTel-native observability.** Adopting OpenTelemetry spans + an OTLP pipeline is a separate, larger project. This design uses `gen_ai.*` field names inside the envelope so field-level alignment exists ahead of time, but does not introduce OTel SDKs, exporters, or collectors.
- **FakeLlm-based contract tests.** Explicitly rejected — this design tests against the deployed real-LLM runtime via the event chain, not against an in-process stubbed graph.
- **Baseline fingerprinting / metadata drift warnings.** Explicitly rejected — only assertion-defined contract violations fail tests. No snapshot baselines to maintain.

## 15. Approval record

- Assertion-only regression model — approved.
- LangChain callback-based envelope production — approved.
- Real LLM via deployed AgentCore Runtime — approved.
- Extend existing e2e scenarios rather than build a separate harness — approved.
- `EventBusTrap` reuse instead of new `subscribeAndCollect` — approved.
- Always-emit instead of `AGENT_EVAL_MODE` gate — approved.
- Emission lives in `invokeOrchestrator`, not in the consumer — approved.
- DI (`TraceEmitter` interface) instead of Gateway tool for AWS decoupling — approved.
- Service-owned event names in each service's `domain/events.ts`, not a cross-service catalog — approved.
- Event name shape `{SERVICE_AGENT}_AGENT_INVOCATION_TRACED` — approved.
