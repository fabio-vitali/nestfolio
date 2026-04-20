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

describe('investor-profile-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = {
    docClient,
    tableName: 'test-table',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    (resolveAgentRuntimeTarget as jest.Mock).mockResolvedValue(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
    );
  });

  it('dispatches to the AgentCore target and persists IN_PROGRESS + COMPLETED', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { goals: ['retirement'], timeHorizon: '10 years', riskWillingness: 'moderate', confidence: 0.9 },
      'risk-assessment': { riskScore: 45, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.85 },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token-123',
      investorProfile: { age: 35 },
      portfolioState: { totalValue: 50000 },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      goals: expect.objectContaining({ goals: ['retirement'] }),
      risk: expect.objectContaining({ riskScore: 45 }),
      metadata: expect.objectContaining({ modelTiers: ['haiku', 'opus'] }),
    });

    // Should have called PutCommand twice (IN_PROGRESS + COMPLETED)
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        decisionId: 'dp-1',
        upstreamOutputs: expect.any(Object),
      }),
    );
  });

  it('should propagate dispatcher errors', async () => {
    (dispatchAgentInvocation as jest.Mock).mockRejectedValue(new Error('Agent failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-2',
      taskToken: 'token-456',
    })).rejects.toThrow('Agent failure');
  });
});
