const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
  };
});

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  SendTaskSuccessCommand: jest.fn(),
  SendTaskFailureCommand: jest.fn(),
}));

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(jest.fn()),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node) => node),
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.MEMORY_ID = 'mem-test';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { createHandlers, type SfnCallbackDeps } from '../src/handlers/event-listener';

describe('market-intelligence-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([]);
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: SfnCallbackDeps = {
    agentService: { runPipeline: mockRunPipeline },
    memoryClient: {
      openDecisionSession: jest.fn().mockReturnValue({
        writeAgentOutput: mockWriteAgentOutput,
        readUpstreamOutput: mockReadUpstreamOutput,
        searchLongTermMemory: mockSearchLongTermMemory,
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    } as any,
  };

  const handlers = createHandlers(mockDeps);

  const baseCtx: EventContext = {
    eventId: 'evt-1',
    eventType: 'ANALYZE_MARKET',
    tenantId: 't1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'market-intelligence-ctrl',
    record: {} as any,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      signals: [{ type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' }],
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish momentum',
      confidenceScore: 0.85,
      metadata: { durationMs: 900, modelTier: 'sonnet' },
    });
  });

  it('should run agent pipeline and return output with intents', async () => {
    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        upstreamOutputs: { investorProfile: { riskScore: 45 } },
      },
    };

    const result = await handlers.ANALYZE_MARKET(payload, baseCtx);

    expect(result.output).toEqual({ decisionId: 'dp-1', tenantId: 't1' });
    expect(result.intents).toHaveLength(1);

    expect(mockRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      decisionId: 'dp-1',
    }));

    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('market signals sector trends');
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
  });

  it('should propagate agent errors', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
      },
    };

    await expect(handlers.ANALYZE_MARKET(payload, baseCtx)).rejects.toThrow('Agent pipeline failed');
  });
});
