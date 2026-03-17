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
jest.mock('@nestfolio/agent-core', () => ({
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: jest.fn(),
}));
jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('portfolio-engine-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockPublish = jest.fn();
  const mockIngest = jest.fn();

  const mockDeps: EventListenerDeps = {
    agentService: { runPipeline: mockRunPipeline },
    bus: { publish: mockPublish },
    kbIngestionHandler: { ingest: mockIngest },
  };

  const harness = createTestHarness({
    serviceName: 'portfolio-engine-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      allocations: { allocations: [{ instrument: 'VTI', targetWeight: 0.6 }] },
      trades: { trades: [{ action: 'BUY', instrument: 'VTI' }] },
    });
    mockPublish.mockResolvedValue(undefined);
    mockIngest.mockResolvedValue(undefined);
  });

  it('should route CONSTRUCT_PORTFOLIO to agent pipeline and publish completion', async () => {
    const result = await harness.process([
      fakeSqsRecord('CONSTRUCT_PORTFOLIO', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        context: { riskCategory: 'MODERATE' },
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith([expect.objectContaining({
      type: 'PORTFOLIO_COMPLETED',
    })]);
  });

  it('should route SEC_PROSPECTUS_UPDATED to KB ingestion', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_PROSPECTUS_UPDATED', {
        filingId: 'f-1',
        content: 'Prospectus content',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockIngest).toHaveBeenCalled();
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
      fakeSqsRecord('CONSTRUCT_PORTFOLIO', {
        tenantId: 't1', decisionId: 'dp-1', taskToken: 'token',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });
});
