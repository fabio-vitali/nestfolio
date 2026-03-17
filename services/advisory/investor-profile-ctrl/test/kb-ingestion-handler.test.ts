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

describe('investor-profile-ctrl kb-ingestion-handler', () => {
  const mockDeps: KbIngestionDeps = {
    s3: { send: mockS3Send } as any,
    bedrockAgent: { send: mockBedrockSend } as any,
    kbBucket: 'test-kb-bucket',
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'investor-profile-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockBedrockSend.mockResolvedValue({});
  });

  it('should write DECISION_BLOCKED narrative to S3 and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', {
        decisionId: 'dp-1',
        reason: 'Exceeds risk limits',
        riskCategory: 'AGGRESSIVE',
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
    expect(mockBedrockSend).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'StartIngestionJob',
      input: expect.objectContaining({
        knowledgeBaseId: 'test-kb-id',
        dataSourceId: 'test-ds-id',
      }),
    }));
  });

  it('should write DECISION_APPROVED narrative to S3 and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_APPROVED', {
        decisionId: 'dp-2',
        authorityLevel: 'L1',
        riskCategory: 'MODERATE',
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockS3Send).toHaveBeenCalled();
    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should report failure on S3 write error', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('S3 write failed'));

    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', {
        decisionId: 'dp-3',
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });
});
