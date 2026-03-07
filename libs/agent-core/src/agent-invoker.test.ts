import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

import { invokeGraph } from './agent-invoker';
import { AgentNodeMap } from './graph-orchestrator';
import { AgentType } from './model-config';

// Mock the graph-orchestrator to avoid real LangGraph compilation
jest.mock('./graph-orchestrator', () => {
  const actual = jest.requireActual('./graph-orchestrator');
  return {
    ...actual,
    buildDecisionGraph: jest.fn(),
  };
});

import { buildDecisionGraph } from './graph-orchestrator';

const mockBuildDecisionGraph = buildDecisionGraph as jest.MockedFunction<
  typeof buildDecisionGraph
>;

describe('invokeGraph', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockMetrics: jest.Mocked<Metrics>;
  let mockNodeMap: AgentNodeMap;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    mockMetrics = {
      addMetric: jest.fn(),
      publishStoredMetrics: jest.fn(),
    } as unknown as jest.Mocked<Metrics>;

    const agentTypes: AgentType[] = [
      'user-goals',
      'risk-assessment',
      'market-research',
      'portfolio-construction',
      'rebalance-planner',
      'explainability',
    ];

    mockNodeMap = {} as AgentNodeMap;
    for (const agentType of agentTypes) {
      mockNodeMap[agentType] = jest.fn().mockResolvedValue({
        [agentType]: { mock: true },
      });
    }
  });

  it('returns the graph result on success', async () => {
    const expectedResult = {
      input: 'test',
      'user-goals': { mock: true },
      'risk-assessment': { mock: true },
      'market-research': { mock: true },
      'portfolio-construction': { mock: true },
      'rebalance-planner': { mock: true },
      'explainability': { mock: true },
    };

    mockBuildDecisionGraph.mockReturnValue({
      invoke: jest.fn().mockResolvedValue(expectedResult),
    } as never);

    const result = await invokeGraph(
      { input: 'test' },
      { nodeMap: mockNodeMap, logger: mockLogger, metrics: mockMetrics },
    );

    expect(result).toEqual(expectedResult);
  });

  it('logs start and completion', async () => {
    mockBuildDecisionGraph.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ input: 'test' }),
    } as never);

    await invokeGraph(
      { input: 'test' },
      { nodeMap: mockNodeMap, logger: mockLogger, metrics: mockMetrics },
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Graph invocation started',
      expect.any(Object),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Graph invocation completed',
      expect.any(Object),
    );
  });

  it('tracks latency and success metrics', async () => {
    mockBuildDecisionGraph.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ input: 'test' }),
    } as never);

    await invokeGraph(
      { input: 'test' },
      { nodeMap: mockNodeMap, logger: mockLogger, metrics: mockMetrics },
    );

    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'GraphLatency',
      MetricUnit.Milliseconds,
      expect.any(Number),
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'GraphSuccess',
      MetricUnit.Count,
      1,
    );
    expect(mockMetrics.publishStoredMetrics).toHaveBeenCalled();
  });

  it('falls back to the fallback graph on primary failure', async () => {
    const fallbackResult = { input: 'fallback' };

    mockBuildDecisionGraph
      .mockReturnValueOnce({
        invoke: jest.fn().mockRejectedValue(new Error('Primary failed')),
      } as never)
      .mockReturnValueOnce({
        invoke: jest.fn().mockResolvedValue(fallbackResult),
      } as never);

    const fallbackNodeMap = { ...mockNodeMap };

    const result = await invokeGraph(
      { input: 'test' },
      {
        nodeMap: mockNodeMap,
        fallbackNodeMap,
        logger: mockLogger,
        metrics: mockMetrics,
      },
    );

    expect(result).toEqual(fallbackResult);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Graph invocation failed',
      expect.objectContaining({ error: 'Primary failed' }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Attempting fallback graph invocation',
    );
    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'FallbackSuccess',
      MetricUnit.Count,
      1,
    );
  });

  it('throws when both primary and fallback fail', async () => {
    mockBuildDecisionGraph
      .mockReturnValueOnce({
        invoke: jest.fn().mockRejectedValue(new Error('Primary failed')),
      } as never)
      .mockReturnValueOnce({
        invoke: jest.fn().mockRejectedValue(new Error('Fallback failed')),
      } as never);

    const fallbackNodeMap = { ...mockNodeMap };

    await expect(
      invokeGraph(
        { input: 'test' },
        {
          nodeMap: mockNodeMap,
          fallbackNodeMap,
          logger: mockLogger,
          metrics: mockMetrics,
        },
      ),
    ).rejects.toThrow('Fallback failed');

    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'FallbackError',
      MetricUnit.Count,
      1,
    );
  });

  it('throws directly when no fallback is provided', async () => {
    mockBuildDecisionGraph.mockReturnValue({
      invoke: jest.fn().mockRejectedValue(new Error('Graph failed')),
    } as never);

    await expect(
      invokeGraph(
        { input: 'test' },
        { nodeMap: mockNodeMap, logger: mockLogger, metrics: mockMetrics },
      ),
    ).rejects.toThrow('Graph failed');

    expect(mockMetrics.addMetric).toHaveBeenCalledWith(
      'GraphError',
      MetricUnit.Count,
      1,
    );
  });
});
