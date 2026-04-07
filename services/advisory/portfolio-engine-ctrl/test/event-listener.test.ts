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

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { createHandlers, type SfnCallbackDeps } from '../src/handlers/event-listener';

describe('portfolio-engine-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockIngest = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([]);
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: SfnCallbackDeps = {
    agentService: { runPipeline: mockRunPipeline },
    kbIngestionHandler: { ingest: mockIngest },
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
    eventType: 'CONSTRUCT_PORTFOLIO',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'portfolio-engine-ctrl',
    record: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      allocations: { allocations: [{ instrument: 'VTI', targetWeight: 0.6 }] },
      trades: { trades: [{ action: 'BUY', instrument: 'VTI' }] },
    });
    mockIngest.mockResolvedValue(undefined);
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

    const result = await handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx);

    expect(result.output).toEqual({ decisionId: 'dp-1', tenantId: 't1' });
    expect(result.intents).toHaveLength(1);
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('market-intelligence');
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('allocation rationale decisions');
    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
  });

  it('should route SEC_PROSPECTUS_UPDATED to KB ingestion', async () => {
    const kbCtx: EventContext = { ...baseCtx, eventType: 'SEC_PROSPECTUS_UPDATED' };
    const payload: EventPayload = {
      subject: {
        filingId: 'f-1',
        content: 'Prospectus content',
      },
    };

    const result = await handlers.SEC_PROSPECTUS_UPDATED(payload, kbCtx);

    expect(result.output).toEqual({ eventType: 'SEC_PROSPECTUS_UPDATED', status: 'ingested' });
    expect(mockIngest).toHaveBeenCalled();
  });

  it('should propagate agent errors', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent failed'));

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-1', taskToken: 'token' },
    };

    await expect(handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx)).rejects.toThrow('Agent failed');
  });
});
