import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);
const mockAgentNode = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(mockAgentNode),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node, _fallback) => node),
}));

import { createAgentService } from '../src/agent-service';

describe('market-intelligence-ctrl agent-service', () => {
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

  it('should invoke agent node with correct context and persist invocation', async () => {
    mockAgentNode.mockResolvedValue({
      signals: [{ type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' }],
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish momentum in US equities',
      confidenceScore: 0.85,
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token-123',
      upstreamOutputs: { investorProfile: { riskScore: 45 } },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      signals: expect.arrayContaining([expect.objectContaining({ ticker: 'SPY' })]),
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish momentum in US equities',
      confidenceScore: 0.85,
      metadata: expect.objectContaining({ modelTier: 'sonnet' }),
    });

    // Should have called PutCommand twice (IN_PROGRESS + COMPLETED)
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
  });

  it('should propagate agent errors', async () => {
    mockAgentNode.mockRejectedValue(new Error('Agent failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-2',
      taskToken: 'token-456',
    })).rejects.toThrow('Agent failure');
  });
});
