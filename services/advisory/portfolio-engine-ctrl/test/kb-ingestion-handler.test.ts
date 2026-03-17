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

describe('portfolio-engine-ctrl kb-ingestion-handler', () => {
  const mockDeps: KbIngestionDeps = {
    s3: { send: mockS3Send } as any,
    bedrockAgent: { send: mockBedrockSend } as any,
    kbBucket: 'test-kb-bucket',
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'portfolio-engine-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockBedrockSend.mockResolvedValue({});
  });

  it('should write SEC_PROSPECTUS_UPDATED inline content to S3 and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_PROSPECTUS_UPDATED', {
        filingId: 'f-1',
        content: 'ETF prospectus content here',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'PutObject',
      input: expect.objectContaining({ Bucket: 'test-kb-bucket' }),
    }));
    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should write SEC_10K_UPDATED content to S3', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_10K_UPDATED', {
        filingId: 'f-2',
        content: '10-K risk factors content',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockS3Send).toHaveBeenCalled();
  });

  it('should fail when no content or preSignedUrl provided', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_PROSPECTUS_UPDATED', {
        filingId: 'f-3',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });
});
