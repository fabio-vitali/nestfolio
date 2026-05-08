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
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: jest.fn(),
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
  UnknownOperatingModeError: jest.requireActual('@nestfolio/agent-orchestrator').UnknownOperatingModeError,
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
import { createHandlers, type SfnCallbackDeps } from '../../src/handlers/event-listener';

describe('investor-profile-ctrl event-listener', () => {
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
    } as SfnCallbackDeps['memoryClient'],
  };

  const handlers = createHandlers(mockDeps);

  const baseCtx: EventContext = {
    eventId: 'evt-1',
    eventType: 'ANALYZE_INVESTOR_PROFILE',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'investor-profile-ctrl',
    record: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      goals: { goals: ['retirement'], timeHorizon: '10 years', riskWillingness: 'moderate', confidence: 0.9 },
      risk: { riskScore: 45, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.85 },
      metadata: { durationMs: 1200, modelTiers: ['haiku', 'opus'] },
    });
  });

  it('should run agent pipeline and return output with intents', async () => {
    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        investorProfile: { age: 35, income: 100000, operatingMode: 'BALANCED' },
        portfolioState: { totalValue: 50000 },
      },
    };

    const result = await handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx);

    expect(result.output).toEqual({ decisionId: 'dp-1', tenantId: 't1' });
    expect(result.intents).toHaveLength(1);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1' }),
    );

    // taskToken should NOT be passed to runPipeline (pipeline handles SFN resume)
    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.not.objectContaining({ taskToken: expect.anything() }),
    );

    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('investor preferences risk tolerance');
    // Memory persistence happens inside the AgentRuntime (graph.ts), not in the
    // Lambda — see services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts
    // The Lambda's previous wrap-write was a no-op (deduplicated by requestIdentifier).
    expect(mockWriteAgentOutput).not.toHaveBeenCalled();
  });

  it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../../src/agent-service');
    mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-dup',
        taskToken: 'tok',
        investorProfile: { operatingMode: 'BALANCED' },
      },
    };

    const dupCtx: EventContext = { ...baseCtx, eventId: 'evt-dup' };
    const result = await handlers.ANALYZE_INVESTOR_PROFILE(payload, dupCtx);

    expect(result.output).toMatchObject({ decisionId: 'dp-dup', tenantId: 't1', deduplicated: true });
    expect(result.intents).toBeUndefined();
    expect(mockWriteAgentOutput).not.toHaveBeenCalled();
  });

  it('should propagate agent errors', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        investorProfile: { operatingMode: 'BALANCED' },
      },
    };

    await expect(handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx)).rejects.toThrow('Agent pipeline failed');
  });

  // Regression: silent BALANCED fallback was masking the propagation bug
  // tracked in docs/backlog/operating-mode-shape-empty-proposed-trades.md.
  it('throws UnknownOperatingModeError when subject.investorProfile.operatingMode is missing', async () => {
    const { UnknownOperatingModeError } = await import('@nestfolio/agent-orchestrator');

    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-no-mode',
        taskToken: 'tok',
        investorProfile: { age: 35 },
      },
    };

    await expect(handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx)).rejects.toThrow(UnknownOperatingModeError);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('falls through to investorProfile.mandate.operatingMode when top-level is absent', async () => {
    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-mandate',
        taskToken: 'tok',
        investorProfile: { age: 35, mandate: { operatingMode: 'AGGRESSIVE' } },
      },
    };

    await handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
    );
  });

  it('passes operatingMode verbatim into runPipeline (regression — silent BALANCED narrowing)', async () => {
    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-prop',
        taskToken: 'tok',
        investorProfile: { age: 35, operatingMode: 'CONSERVATIVE' },
      },
    };

    await handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ operatingMode: 'CONSERVATIVE' }),
    );
  });
});
