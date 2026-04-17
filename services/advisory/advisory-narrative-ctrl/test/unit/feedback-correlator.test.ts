import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';

jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const bedrockMock = mockClient(BedrockAgentClient);

import { createFeedbackCorrelator, type FeedbackCorrelatorDeps } from '../../src/handlers/feedback-correlator';

describe('feedback-correlator', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const bedrockAgent = new BedrockAgentClient({});

  const deps: FeedbackCorrelatorDeps = {
    docClient,
    s3,
    bedrockAgent,
    tableName: 'test-table',
    kbBucket: 'test-kb-bucket',
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const correlator = createFeedbackCorrelator(deps);

  beforeEach(() => {
    ddbMock.reset();
    s3Mock.reset();
    bedrockMock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    bedrockMock.on(StartIngestionJobCommand).resolves({});
  });

  it('should annotate ACCEPTED feedback, write to S3, and trigger KB sync', async () => {
    ddbMock.on(QueryCommand).resolves({
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

    expect(ddbMock).toHaveReceivedCommand(QueryCommand);
    expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: 'test-kb-bucket',
      ContentType: 'application/json',
    });
    expect(bedrockMock).toHaveReceivedCommand(StartIngestionJobCommand);
  });

  it('should annotate REJECTED feedback with reason', async () => {
    ddbMock.on(QueryCommand).resolves({
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

    expect(s3Mock).toHaveReceivedCommand(PutObjectCommand);
    // Verify the annotation contains the rejection reason
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    const body = JSON.parse(putCalls[0].args[0].input.Body as string);
    expect(body.outcome).toBe('REJECTED');
    expect(body.rejectionReason).toBe('Too conservative approach');
  });

  it('should skip when no explanation found in DDB', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await correlator.process({
      subject: { decisionId: 'dp-3', outcome: 'ACCEPTED', riskCategory: 'MODERATE' },
    });

    expect(s3Mock).not.toHaveReceivedCommand(PutObjectCommand);
    expect(bedrockMock).not.toHaveReceivedCommand(StartIngestionJobCommand);
  });
});
