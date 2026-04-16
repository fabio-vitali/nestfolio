import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);
const mockInvokeOrchestrator = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: mockInvokeOrchestrator,
  resolveAgentRuntimeUrl: jest.fn().mockResolvedValue(null),
  invokeRemoteRuntime: jest.fn(),
}));

import { createAgentService } from '../src/agent-service';

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
  });

  it('should invoke orchestrator with correct context and persist invocation', async () => {
    mockInvokeOrchestrator.mockResolvedValue({
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
  });

  it('should propagate orchestrator errors', async () => {
    mockInvokeOrchestrator.mockRejectedValue(new Error('Orchestrator failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1',
      decisionId: 'dp-2',
      taskToken: 'token-456',
    })).rejects.toThrow('Orchestrator failure');
  });
});
