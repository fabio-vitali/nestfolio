const mockS3Send = jest.fn();
const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObject', input })),
}));

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

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.KB_BUCKET = 'test-kb-bucket';
process.env.KB_ID = 'test-kb-id';
process.env.KB_DATA_SOURCE_ID = 'test-ds-id';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createKbIngestionHandlers, type KbIngestionDeps } from '../src/handlers/kb-ingestion-handler';

describe('market-intelligence-ctrl kb-ingestion-handler', () => {
  const mockDeps: KbIngestionDeps = {
    s3: { send: mockS3Send } as any,
    bedrockAgent: { send: mockBedrockSend } as any,
    kbBucket: 'test-kb-bucket',
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'market-intelligence-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockBedrockSend.mockResolvedValue({});
  });

  it('should write YAHOO_FINANCE_UPDATED feed to S3 with correct prefix and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('YAHOO_FINANCE_UPDATED', {
        id: 'yf-001',
        source: 'Yahoo Finance',
        articles: [{ title: 'Markets rally', description: 'S&P 500 up 2%' }],
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'PutObject',
      input: expect.objectContaining({
        Bucket: 'test-kb-bucket',
        ContentType: 'text/plain',
      }),
    }));
    // Verify key prefix
    const putCall = mockS3Send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^feeds\/yahoo-finance\//);
    expect(mockBedrockSend).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'StartIngestionJob',
      input: expect.objectContaining({
        knowledgeBaseId: 'test-kb-id',
        dataSourceId: 'test-ds-id',
      }),
    }));
  });

  it('should write SEC_8K_FILED feed to S3 with correct prefix and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_8K_FILED', {
        id: 'sec-001',
        source: 'SEC EDGAR',
        articles: [{ title: 'AAPL 8-K filing', description: 'Earnings report' }],
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    const putCall = mockS3Send.mock.calls[0][0];
    expect(putCall.input.Key).toMatch(/^feeds\/sec-8k\//);
    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should report failure on S3 write error', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('S3 write failed'));

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
