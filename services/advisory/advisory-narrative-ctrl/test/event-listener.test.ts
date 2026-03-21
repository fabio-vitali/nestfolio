const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
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

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('advisory-narrative-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockPublish = jest.fn();
  const mockProcess = jest.fn();
  const mockWriteAgentOutput = jest.fn().mockResolvedValue(undefined);
  const mockReadUpstreamOutput = jest.fn().mockResolvedValue([]);
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: EventListenerDeps = {
    agentService: { runPipeline: mockRunPipeline },
    bus: { publish: mockPublish },
    feedbackCorrelator: { process: mockProcess },
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
    serviceName: 'advisory-narrative-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      summary: 'Your portfolio was rebalanced...',
      rationale: 'Based on your moderate risk profile...',
      keyFactors: ['market outlook', 'risk tolerance'],
    });
    mockPublish.mockResolvedValue(undefined);
    mockProcess.mockResolvedValue(undefined);
  });

  it('should route GENERATE_NARRATIVE to agent pipeline and publish completion', async () => {
    const result = await harness.process([
      fakeSqsRecord('GENERATE_NARRATIVE', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        context: { riskCategory: 'MODERATE' },
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('market-intelligence');
    expect(mockReadUpstreamOutput).toHaveBeenCalledWith('portfolio-engine');
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('narrative preferences communication style');
    expect(mockSearchLongTermMemory).toHaveBeenCalledWith('session summaries');
    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockWriteAgentOutput).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'dp-1' }));
    expect(mockPublish).toHaveBeenCalledWith([expect.objectContaining({
      type: 'NARRATIVE_COMPLETED',
    })]);

    // Completion event should NOT carry outputs
    const publishedSubject = mockPublish.mock.calls[0][0][0].subject;
    expect(publishedSubject).not.toHaveProperty('outputs');
  });

  it('should route DECISION_FEEDBACK to feedback correlator', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_FEEDBACK', {
        decisionId: 'dp-1',
        outcome: 'ACCEPTED',
        riskCategory: 'MODERATE',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockProcess).toHaveBeenCalled();
  });

  it('should skip unknown event types', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures on agent error', async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error('Agent failed'));
    const result = await harness.process([
      fakeSqsRecord('GENERATE_NARRATIVE', {
        tenantId: 't1', decisionId: 'dp-1', taskToken: 'token',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });
});
