const mockSend = jest.fn();
const mockAgentNode = jest.fn();

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

jest.mock('@nestfolio/agent-core', () => ({
  createAgentNode: jest.fn().mockReturnValue(mockAgentNode),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node, _fallback) => node),
}));

import { createAgentService } from '../src/agent-service';

describe('market-intelligence-ctrl agent-service', () => {
  const deps = {
    docClient: { send: mockSend } as any,
    tableName: 'test-table',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
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
    expect(mockSend).toHaveBeenCalledTimes(2);
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
