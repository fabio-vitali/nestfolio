jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));
jest.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: jest.fn().mockImplementation(() => ({
    addMetric: jest.fn(),
  })),
  MetricUnit: { Count: 'Count', Milliseconds: 'Milliseconds' },
}));

import { invokeOrchestrator } from '../src/invoke-orchestrator';
import type { CompiledGraph } from '../src/create-orchestrator';
import type { TraceEmitter } from '../src/emitters/types';
import type { AgentTraceEnvelope } from '../src/agent-tracer';

describe('invokeOrchestrator', () => {
  const mockGraph: CompiledGraph = {
    invoke: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns graph result on success', async () => {
    (mockGraph.invoke as jest.Mock).mockResolvedValue({ alpha: { result: 'ok' } });
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({ alpha: { result: 'ok' } });
  });

  it('passes input to graph.invoke', async () => {
    (mockGraph.invoke as jest.Mock).mockResolvedValue({});
    await invokeOrchestrator(mockGraph, { input: 'hello' });
    expect(mockGraph.invoke).toHaveBeenCalledWith(
      { input: 'hello' },
      expect.objectContaining({ callbacks: expect.any(Array) }),
    );
  });

  it('returns ServiceUnavailableResponse on graph failure', async () => {
    (mockGraph.invoke as jest.Mock).mockRejectedValue(new Error('graph exploded'));
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({
      serviceUnavailable: true,
      reason: 'graph exploded',
    });
  });

  it('returns ServiceUnavailableResponse with fallback message for non-Error throws', async () => {
    (mockGraph.invoke as jest.Mock).mockRejectedValue('string error');
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({
      serviceUnavailable: true,
      reason: 'Unknown error',
    });
  });
});

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
// `pnpm nx build`, not by Jest. If the `@ts-expect-error` ever stops
// flagging, the union has regressed and this line will fail compile.
describe('InvokeOptions type discipline', () => {
  it('rejects emitter without agent/correlationId at compile time', () => {
    // @ts-expect-error agent and correlationId are required when emitter is set
    const _opts: Parameters<typeof invokeOrchestrator>[2] = { emitter: { emit: async () => { /* noop */ } } };
    expect(_opts).toBeDefined();
  });
});
