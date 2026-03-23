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

describe('portfolio-engine-ctrl kb-ingestion-handler', () => {
  const mockDeps: KbIngestionDeps = {
    bedrockAgent: { send: mockBedrockSend } as any,
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'portfolio-engine-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBedrockSend.mockResolvedValue({});
  });

  it('should return store intent for SEC_PROSPECTUS_UPDATED inline content and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_PROSPECTUS_UPDATED', {
        filingId: 'f-1',
        content: 'ETF prospectus content here',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'store',
      key: expect.stringMatching(/^sec_prospectus_updated\//),
    });
    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should return store intent for SEC_10K_UPDATED content', async () => {
    const result = await harness.process([
      fakeSqsRecord('SEC_10K_UPDATED', {
        filingId: 'f-2',
        content: '10-K risk factors content',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'store' });
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
