const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
}));
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
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { createHandlers, type SfnCallbackDeps } from '../../src/handlers/event-listener';

describe('advisory-narrative-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockProcess = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([]);
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: SfnCallbackDeps = {
    agentService: { runPipeline: mockRunPipeline },
    feedbackCorrelator: { process: mockProcess },
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
    eventType: 'GENERATE_NARRATIVE',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'advisory-narrative-ctrl',
    record: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      summary: 'Your portfolio was rebalanced...',
      rationale: 'Based on your moderate risk profile...',
      keyFactors: ['market outlook', 'risk tolerance'],
    });
    mockProcess.mockResolvedValue(undefined);
  });

  it('should run agent pipeline and return output with intents', async () => {
    const payload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        context: { riskCategory: 'MODERATE' },
      },
    };

    const result = await handlers.GENERATE_NARRATIVE(payload, baseCtx);

    expect(result.output).toEqual({ decisionId: 'dp-1', tenantId: 't1' });
    expect(result.intents).toHaveLength(1);
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('market-intelligence');
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('portfolio-engine');
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('narrative preferences communication style');
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('session summaries');
    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
  });

  it('should route DECISION_FEEDBACK to feedback correlator', async () => {
    const fbCtx: EventContext = { ...baseCtx, eventType: 'DECISION_FEEDBACK' };
    const payload: EventPayload = {
      subject: {
        decisionId: 'dp-1',
        outcome: 'ACCEPTED',
        riskCategory: 'MODERATE',
      },
    };

    const result = await handlers.DECISION_FEEDBACK(payload, fbCtx);

    expect(result.output).toEqual({ eventType: 'DECISION_FEEDBACK', status: 'processed' });
    expect(mockProcess).toHaveBeenCalled();
  });

  it('should propagate agent errors', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent failed'));

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-1', taskToken: 'token' },
    };

    await expect(handlers.GENERATE_NARRATIVE(payload, baseCtx)).rejects.toThrow('Agent failed');
  });
});
