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
// Skip the production read-after-write retry waits in unit tests.
process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE = '0,0,0,0';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { createHandlers, type SfnCallbackDeps } from '../../src/handlers/event-listener';

describe('portfolio-engine-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockIngest = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  // Default Memory record carries operatingMode at top level — mirrors the
  // wrapper write at investor-profile-ctrl event-listener.ts line 57.
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([
    { content: JSON.stringify({ operatingMode: 'BALANCED', 'user-goals': {}, 'risk-assessment': {} }) },
  ]);
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
    mockReadUpstreamOutput.mockResolvedValue([
      { content: JSON.stringify({ operatingMode: 'BALANCED', 'user-goals': {}, 'risk-assessment': {} }) },
    ]);
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
    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1', // ctx.eventId
      expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1' }),
    );
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
  });

  it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../../src/agent-service');
    mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-dup', taskToken: 'tok' },
    };

    const dupCtx: EventContext = { ...baseCtx, eventId: 'evt-dup' };
    const result = await handlers.CONSTRUCT_PORTFOLIO(payload, dupCtx);

    expect(result.output).toMatchObject({ decisionId: 'dp-dup', tenantId: 't1', deduplicated: true });
    expect(result.intents).toBeUndefined();
    expect(mockWriteAgentOutput).not.toHaveBeenCalled();
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

  // Regression: silent BALANCED fallback was masking the propagation bug
  // tracked in docs/backlog/operating-mode-shape-empty-proposed-trades.md.
  // The handler MUST throw UnknownOperatingModeError when the upstream
  // Memory record from investor-profile lacks operatingMode.
  it('throws UnknownOperatingModeError when investor-profile Memory record is missing operatingMode (after retries)', async () => {
    const { UnknownOperatingModeError } = await import('@nestfolio/agent-orchestrator');
    // mockResolvedValue (not Once) so every retry attempt also returns missing.
    mockReadUpstreamOutput.mockResolvedValue([
      { content: JSON.stringify({ 'user-goals': {}, 'risk-assessment': {} }) },
    ]);

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-no-mode', taskToken: 'tok' },
    };

    await expect(handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx)).rejects.toThrow(UnknownOperatingModeError);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it('throws UnknownOperatingModeError when investor-profile Memory is empty (after retries)', async () => {
    const { UnknownOperatingModeError } = await import('@nestfolio/agent-orchestrator');
    mockReadUpstreamOutput.mockResolvedValue([]);

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-empty', taskToken: 'tok' },
    };

    await expect(handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx)).rejects.toThrow(UnknownOperatingModeError);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  // Validates the read-after-write retry path: first investor-profile read
  // empty (mirrors AgentCore Memory eventual consistency lag), retry succeeds.
  // Should NOT throw. Note: readUpstreamOutput is also called for
  // 'market-intelligence' — the retry only re-reads 'investor-profile'.
  it('retries readUpstreamOutput("investor-profile") when first read is empty and succeeds on retry', async () => {
    mockReadUpstreamOutput.mockImplementation(async (svc: string) => {
      if (svc === 'market-intelligence') return [];
      // investor-profile: first call empty, subsequent calls return the record
      if (mockReadUpstreamOutput.mock.calls.filter((c) => c[0] === 'investor-profile').length <= 1) {
        return [];
      }
      return [
        { content: JSON.stringify({ operatingMode: 'CONSERVATIVE', 'user-goals': {}, 'risk-assessment': {} }) },
      ];
    });

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-retry', taskToken: 'tok' },
    };

    await handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx);

    const investorProfileCalls = mockReadUpstreamOutput.mock.calls.filter((c) => c[0] === 'investor-profile').length;
    expect(investorProfileCalls).toBeGreaterThanOrEqual(2);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ operatingMode: 'CONSERVATIVE' }),
    );
  });

  it('passes operatingMode from Memory through to runPipeline (regression — silent BALANCED narrowing)', async () => {
    mockReadUpstreamOutput.mockResolvedValueOnce([
      { content: JSON.stringify({ operatingMode: 'AGGRESSIVE', 'user-goals': {}, 'risk-assessment': {} }) },
    ]);

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-prop', taskToken: 'tok' },
    };

    await handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
    );
  });
});
