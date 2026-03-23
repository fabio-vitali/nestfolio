const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  StartIngestionJobCommand: jest.fn().mockImplementation((input) => ({ _type: 'StartIngestionJob', input })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: jest.fn() })) },
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.KB_BUCKET = 'test-kb-bucket';
process.env.KB_ID = 'test-kb-id';
process.env.KB_DATA_SOURCE_ID = 'test-ds-id';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createKbIngestionHandlers, type KbIngestionDeps } from '../src/handlers/kb-ingestion-handler';

describe('market-intelligence-ctrl kb-ingestion-handler', () => {
  const mockDeps: KbIngestionDeps = {
    bedrockAgent: { send: mockBedrockSend } as any,
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'market-intelligence-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBedrockSend.mockResolvedValue({});
  });

  it('should return store intent for YAHOO_FINANCE_UPDATED with correct key prefix and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('YAHOO_FINANCE_UPDATED', {
        id: 'yf-001',
        source: 'Yahoo Finance',
        articles: [{ title: 'Markets rally', description: 'S&P 500 up 2%' }],
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'store',
      key: expect.stringMatching(/^feeds\/yahoo-finance\//),
    });
    expect(mockBedrockSend).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'StartIngestionJob',
      input: expect.objectContaining({
        knowledgeBaseId: 'test-kb-id',
        dataSourceId: 'test-ds-id',
      }),
    }));
  });

  it('should return store intent for SEC_8K_FILED with correct key prefix and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_8K_FILED', {
        id: 'sec-001',
        source: 'SEC EDGAR',
        articles: [{ title: 'AAPL 8-K filing', description: 'Earnings report' }],
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'store',
      key: expect.stringMatching(/^feeds\/sec-8k\//),
    });
    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should report failure when Bedrock sync throws', async () => {
    mockBedrockSend.mockRejectedValueOnce(new Error('Bedrock sync failed'));

    const result = await harness.process([
      fakeSqsRecord('YAHOO_FINANCE_UPDATED', {
        id: 'yf-002',
        source: 'Yahoo Finance',
        articles: [],
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });
});
