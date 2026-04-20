import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('@nestfolio/agent-orchestrator', () => ({
  resolveAgentRuntimeTarget: jest.fn().mockResolvedValue(
    'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
  ),
  dispatchAgentInvocation: jest.fn(),
}));

import { createAgentService } from '../../src/agent-service';
import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
} from '@nestfolio/agent-orchestrator';

describe('advisory-narrative-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = { docClient, tableName: 'test-table' };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    (resolveAgentRuntimeTarget as jest.Mock).mockResolvedValue(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
    );
  });

  it('dispatches to the AgentCore target and persists IN_PROGRESS + ReasoningOutput + COMPLETED', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
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
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 3);
    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        decisionId: 'dp-1',
        upstreamOutputs: expect.any(Object),
      }),
    );
  });

  it('propagates dispatcher errors', async () => {
    (dispatchAgentInvocation as jest.Mock).mockRejectedValue(new Error('Agent failure'));
    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Agent failure');
  });
});
