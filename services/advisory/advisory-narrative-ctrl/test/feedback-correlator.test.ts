const mockDdbSend = jest.fn();
const mockS3Send = jest.fn();
const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockDdbSend })) },
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObject', input })),
}));
jest.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  StartIngestionJobCommand: jest.fn().mockImplementation((input) => ({ _type: 'StartIngestionJob', input })),
}));
jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createFeedbackCorrelator, type FeedbackCorrelatorDeps } from '../src/handlers/feedback-correlator';

describe('feedback-correlator', () => {
  const deps: FeedbackCorrelatorDeps = {
    docClient: { send: mockDdbSend } as any,
    s3: { send: mockS3Send } as any,
    bedrockAgent: { send: mockBedrockSend } as any,
    tableName: 'test-table',
    kbBucket: 'test-kb-bucket',
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const correlator = createFeedbackCorrelator(deps);

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    mockBedrockSend.mockResolvedValue({});
  });

  it('should annotate ACCEPTED feedback, write to S3, and trigger KB sync', async () => {
    mockDdbSend.mockResolvedValue({
      Items: [{
        tenantId: 't1',
        summary: 'Portfolio rebalanced for moderate risk.',
        tone: 'educational',
        wordCount: 250,
        keyFactors: ['market outlook', 'risk tolerance'],
      }],
    });

    await correlator.process({
      subject: {
        decisionId: 'dp-1',
        outcome: 'ACCEPTED',
        riskCategory: 'MODERATE',
      },
    });

    expect(mockDdbSend).toHaveBeenCalled();
    expect(mockS3Send).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'PutObject',
      input: expect.objectContaining({
        Bucket: 'test-kb-bucket',
        ContentType: 'application/json',
      }),
    }));
    expect(mockBedrockSend).toHaveBeenCalledWith(expect.objectContaining({
      _type: 'StartIngestionJob',
    }));
  });

  it('should annotate REJECTED feedback with reason', async () => {
    mockDdbSend.mockResolvedValue({
      Items: [{
        tenantId: 't1',
        summary: 'Portfolio rebalanced.',
        tone: 'technical',
        wordCount: 300,
        keyFactors: ['diversification'],
      }],
    });

    await correlator.process({
      subject: {
        decisionId: 'dp-2',
        outcome: 'REJECTED',
        rejectionReason: 'Too conservative approach',
        riskCategory: 'AGGRESSIVE',
      },
    });

    expect(mockS3Send).toHaveBeenCalled();
    // Verify the annotation contains the rejection reason
    const putCall = mockS3Send.mock.calls[0][0];
    const body = JSON.parse(putCall.input.Body);
    expect(body.outcome).toBe('REJECTED');
    expect(body.rejectionReason).toBe('Too conservative approach');
  });

  it('should skip when no explanation found in DDB', async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });

    await correlator.process({
      subject: { decisionId: 'dp-3', outcome: 'ACCEPTED', riskCategory: 'MODERATE' },
    });

    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });
});
