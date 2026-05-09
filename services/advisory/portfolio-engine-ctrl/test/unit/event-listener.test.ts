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
// Short-circuit the Memory read-after-write retry waits in unit tests.
process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE = '0,0,0,0';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { createHandlers, type SfnCallbackDeps } from '../../src/handlers/event-listener';

describe('portfolio-engine-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockIngest = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  // operatingMode now arrives via subject.operatingMode (SF state propagation
  // from InvokeInvestorProfile result). The Memory record holds the agent's
  // full output context (goals, risk-assessment) but no longer carries
  // operatingMode as the source-of-truth for shape.
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([
    { content: JSON.stringify({ 'user-goals': {}, 'risk-assessment': {} }) },
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
      { content: JSON.stringify({ 'user-goals': {}, 'risk-assessment': {} }) },
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
        operatingMode: 'BALANCED',
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
      expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1', operatingMode: 'BALANCED' }),
    );
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
  });

  it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../../src/agent-service');
    mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-dup', taskToken: 'tok', operatingMode: 'BALANCED' },
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
      subject: { tenantId: 't1', decisionId: 'dp-1', taskToken: 'token', operatingMode: 'BALANCED' },
    };

    await expect(handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx)).rejects.toThrow('Agent failed');
  });

  // operatingMode is now propagated via SF state on subject.operatingMode
  // (decision-state-machine.ts wires it from $.agentResults.InvokeInvestorProfile.operatingMode).
  // The handler MUST throw UnknownOperatingModeError if the field is missing
  // from the subject — silent BALANCED fallback was masking propagation bugs
  // (see docs/backlog/operating-mode-shape-empty-proposed-trades.md).
  it('throws UnknownOperatingModeError when subject.operatingMode is missing', async () => {
    const { UnknownOperatingModeError } = await import('@nestfolio/agent-orchestrator');

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-no-mode', taskToken: 'tok' },
    };

    await expect(handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx)).rejects.toThrow(UnknownOperatingModeError);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  // Memory has >40s eventual-consistency on ListMemoryRecords. The Lambda
  // retries until the upstream investor-profile record is non-empty. The agent
  // gets degraded input (empty investorProfile) if reads return empty without
  // retry — driving empty proposedTrades downstream.
  it('retries readUpstreamOutput("investor-profile") when first read is empty and proceeds when retry returns content', async () => {
    mockReadUpstreamOutput.mockImplementation(async (svc: string) => {
      if (svc === 'market-intelligence') return [];
      if (mockReadUpstreamOutput.mock.calls.filter((c) => c[0] === 'investor-profile').length <= 1) {
        return [];
      }
      return [
        { content: JSON.stringify({ 'user-goals': { goalType: 'GROWTH' }, 'risk-assessment': {} }) },
      ];
    });

    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-retry', taskToken: 'tok', operatingMode: 'CONSERVATIVE' },
    };

    await handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx);

    const investorProfileCalls = mockReadUpstreamOutput.mock.calls.filter((c) => c[0] === 'investor-profile').length;
    expect(investorProfileCalls).toBeGreaterThanOrEqual(2);
    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({
        operatingMode: 'CONSERVATIVE',
        investorProfile: expect.objectContaining({ 'user-goals': { goalType: 'GROWTH' } }),
      }),
    );
  });

  it('passes operatingMode from subject through to runPipeline', async () => {
    const payload: EventPayload = {
      subject: { tenantId: 't1', decisionId: 'dp-prop', taskToken: 'tok', operatingMode: 'AGGRESSIVE' },
    };

    await handlers.CONSTRUCT_PORTFOLIO(payload, baseCtx);

    expect(mockRunPipeline).toHaveBeenCalledWith(
      'evt-1',
      expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
    );
  });
});
