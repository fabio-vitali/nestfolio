import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);
const mockAgentNode = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(mockAgentNode),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node) => node),
}));

import { createAgentService } from '../src/agent-service';

describe('advisory-narrative-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = {
    docClient,
    tableName: 'test-table',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
  });

  it('should invoke agent and return narrative result', async () => {
    mockAgentNode.mockResolvedValue({
      summary: 'Your portfolio was rebalanced to align with your moderate risk profile.',
      rationale: 'Based on market conditions and your investment goals...',
      keyFactors: ['market outlook', 'risk tolerance', 'time horizon'],
      tone: 'educational',
      wordCount: 250,
      confidence: 0.85,
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token',
      context: { riskCategory: 'MODERATE' },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      summary: expect.any(String),
      rationale: expect.any(String),
      keyFactors: expect.any(Array),
      metadata: expect.objectContaining({ modelTier: 'sonnet' }),
    });
    // Should write: IN_PROGRESS, REASONING, COMPLETED
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 3);
  });

  it('should propagate agent errors', async () => {
    mockAgentNode.mockRejectedValue(new Error('Agent failure'));
    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Agent failure');
  });
});
