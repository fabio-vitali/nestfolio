jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
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
    expect(mockGraph.invoke).toHaveBeenCalledWith({ input: 'hello' });
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
