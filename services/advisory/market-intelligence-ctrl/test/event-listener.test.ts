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

jest.mock('@nestfolio/agent-core', () => ({
  createAgentNode: jest.fn().mockReturnValue(jest.fn()),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node) => node),
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

describe('market-intelligence-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockPublish = jest.fn();

  const mockDeps: EventListenerDeps = {
    agentService: { runPipeline: mockRunPipeline },
    bus: { publish: mockPublish },
  };

  const harness = createTestHarness({
    serviceName: 'market-intelligence-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue({
      decisionId: 'dp-1',
      signals: [{ type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' }],
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish momentum',
      confidenceScore: 0.85,
      metadata: { durationMs: 900, modelTier: 'sonnet' },
    });
    mockPublish.mockResolvedValue(undefined);
  });

  it('should route ANALYZE_MARKET to agent pipeline and publish completion', async () => {
    const result = await harness.process([
      fakeSqsRecord('ANALYZE_MARKET', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
        upstreamOutputs: { investorProfile: { riskScore: 45 } },
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockRunPipeline).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token-123',
    }));
    expect(mockPublish).toHaveBeenCalledWith([expect.objectContaining({
      type: 'MARKET_ANALYSIS_COMPLETED',
      subject: expect.objectContaining({
        decisionId: 'dp-1',
        taskToken: 'token-123',
      }),
    })]);
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
      fakeSqsRecord('ANALYZE_MARKET', {
        tenantId: 't1',
        decisionId: 'dp-1',
        taskToken: 'token-123',
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });
});
