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

describe('investor-profile-ctrl event-listener', () => {
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
    eventType: 'ANALYZE_INVESTOR_PROFILE',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'investor-profile-ctrl',
    record: {},
  };

  const defaultAgentResult = {
    decisionId: 'dp-1',
    goals: { goals: ['retirement'], timeHorizon: '10 years', riskWillingness: 'moderate', confidence: 0.9 },
    risk: { riskScore: 45, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.85 },
    metadata: { durationMs: 1200, modelTiers: ['haiku', 'opus'] },
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
        investorProfile: { age: 35, income: 100000, operatingMode: 'BALANCED' },
        portfolioState: { totalValue: 50000 },
      },
    };

    const result = await handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx);

    // Output carries operatingMode for downstream SF Task states + agentOutput
    // so Wave 1 (portfolio-engine) and Wave 2 (advisory-narrative) plus
    // AssembleDecisionPacket can read the result via SF state
    // ($.agentResults.InvokeInvestorProfile.agentOutput) — Option A,
    // avoiding the AgentCore Memory ListMemoryRecords eventual-consistency gap.
    expect(result.output).toEqual({
      decisionId: 'dp-1',
      tenantId: 't1',
      operatingMode: 'BALANCED',
      agentOutput: defaultAgentResult,
    });
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

    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('preferences', 'investor preferences risk tolerance');
    // Memory persistence happens inside the AgentRuntime (graph.ts), not in the
    // Lambda — and the writeAgentOutput method has been dropped from MemoryClient
    // entirely (Phase A inter-agent state handoff moved to SF state).
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

  it('returns the agent result inside SF output for downstream consumers', async () => {
    const fakeResult = {
      decisionId: 'dp-agent-out',
      goals: { goals: ['college'], timeHorizon: '5 years', riskWillingness: 'moderate', confidence: 0.7 },
      risk: { riskScore: 60, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.9 },
      investorClassification: 'RETAIL',
      metadata: { durationMs: 800, modelTiers: ['haiku', 'opus'] },
    };
    mockRunPipeline.mockResolvedValueOnce(fakeResult);

    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-agent-out',
        taskToken: 'tok',
        investorProfile: { age: 40, operatingMode: 'BALANCED' },
      },
    };

    const result = await handlers.ANALYZE_INVESTOR_PROFILE(payload, baseCtx);

    expect(result.output.agentOutput).toEqual(fakeResult);
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
