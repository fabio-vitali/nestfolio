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
  wrapAgentOutput: jest.requireActual('@nestfolio/agent-orchestrator').wrapAgentOutput,
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
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import type { MemoryClient } from '@nestfolio/agent-orchestrator';
import { createHandlers, type SfnCallbackDeps } from '../../src/handlers/event-listener';

describe('market-intelligence-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: SfnCallbackDeps = {
    agentService: { runPipeline: mockRunPipeline },
    memoryClient: {
      openDecisionSession: jest.fn().mockReturnValue({
        searchLongTermMemory: mockSearchLongTermMemory,
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    } satisfies Partial<MemoryClient> as MemoryClient,
  };

  const handlers = createHandlers(mockDeps);

  const baseCtx: EventContext = {
    eventId: 'evt-1',
    eventType: 'ANALYZE_MARKET',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'market-intelligence-ctrl',
    record: {},
  };

  const defaultAgentResult = {
    decisionId: 'dp-1',
    signals: [{ type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' }],
    tickersMentioned: ['SPY'],
    marketOutlook: 'Bullish momentum',
    confidenceScore: 0.85,
    metadata: { durationMs: 900, modelTier: 'sonnet' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue(defaultAgentResult);
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

    // Output now carries agentOutput so downstream SF Task states
    // (portfolio-engine, advisory-narrative) and AssembleDecisionPacket can
    // read the market analysis via $.agentResults.InvokeMarketIntelligence.agentOutput.
    expect(result.output).toEqual({
      decisionId: 'dp-1',
      tenantId: 't1',
      agentOutput: defaultAgentResult,
    });
    expect(result.intents).toHaveLength(1);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1' }),
    );

    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('market signals sector trends');
    // Memory persistence is owned by the AgentRuntime — writeAgentOutput has
    // been dropped from MemoryClient entirely (Phase A inter-agent state handoff
    // moved to SF state).
  });

  it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../../src/agent-service');
    mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-dup', taskToken: 'tok' },
    };

    const dupCtx: EventContext = { ...baseCtx, eventId: 'evt-dup' };
    const result = await handlers.ANALYZE_MARKET(payload, dupCtx);

    expect(result.output).toMatchObject({ decisionId: 'dp-dup', tenantId: 't1', deduplicated: true });
    expect(result.intents).toBeUndefined();
  });

  it('returns the agent result inside SF output for downstream consumers', async () => {
    const fakeResult = {
      decisionId: 'dp-agent-out',
      signals: [{ type: 'sentiment', ticker: 'NVDA', sentiment: 'BULLISH', confidence: 0.92, source: 'news' }],
      tickersMentioned: ['NVDA', 'AMD'],
      sectors: { technology: 'BULLISH', energy: 'NEUTRAL' },
      marketOutlook: 'Strong tech momentum',
      outlook: 'BULLISH',
      confidenceScore: 0.91,
      metadata: { durationMs: 700, modelTier: 'sonnet' },
    };
    mockRunPipeline.mockResolvedValueOnce(fakeResult);

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-agent-out', taskToken: 'tok' },
    };

    const result = await handlers.ANALYZE_MARKET(payload, baseCtx);

    expect(result.output.agentOutput).toEqual(fakeResult);
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
