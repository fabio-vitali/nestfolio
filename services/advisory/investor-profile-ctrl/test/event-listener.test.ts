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

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: jest.fn(),
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

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('investor-profile-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockPublish = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([]);
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: EventListenerDeps = {
    agentService: { runPipeline: mockRunPipeline },
    bus: { publish: mockPublish },
    memoryClient: {
      openDecisionSession: jest.fn().mockReturnValue({
        writeAgentOutput: mockWriteAgentOutput,
        readUpstreamOutput: mockReadUpstreamOutput,
        searchLongTermMemory: mockSearchLongTermMemory,
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    } as any,
  };

  const harness = createTestHarness({
    serviceName: 'investor-profile-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      goals: { goals: ['retirement'], timeHorizon: '10 years', riskWillingness: 'moderate', confidence: 0.9 },
      risk: { riskScore: 45, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.85 },
      metadata: { durationMs: 1200, modelTiers: ['haiku', 'opus'] },
    });
    mockPublish.mockResolvedValue(undefined);
  });

  it('should route ANALYZE_INVESTOR_PROFILE to agent pipeline and publish completion', async () => {
    const result = await harness.process([
      fakeSqsRecord('ANALYZE_INVESTOR_PROFILE', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        investorProfile: { age: 35, income: 100000 },
        portfolioState: { totalValue: 50000 },
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token-123',
    }));

    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('investor preferences risk tolerance');
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
    expect(mockPublish).toHaveBeenCalledWith([expect.objectContaining({
      type: 'INVESTOR_PROFILE_COMPLETED',
      subject: expect.objectContaining({
        decisionId: 'dp-1',
        taskToken: 'token-123',
      }),
    })]);

    // Completion event should NOT carry outputs
    const publishedSubject = mockPublish.mock.calls[0][0][0].subject;
    expect(publishedSubject).not.toHaveProperty('outputs');
  });

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('should report batch item failures on agent error', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

    const result = await harness.process([
      fakeSqsRecord('ANALYZE_INVESTOR_PROFILE', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });
});
