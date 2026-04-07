import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);
const mockInvokeOrchestrator = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: mockInvokeOrchestrator,
}));

import { createAgentService } from '../src/agent-service';

describe('portfolio-engine-ctrl agent-service', () => {
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

  it('should invoke orchestrator and return allocations + trades', async () => {
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [{ instrument: 'VTI', targetWeight: 0.6 }] },
      'rebalance-planner': { trades: [{ action: 'BUY', instrument: 'VTI' }] },
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
      allocations: expect.objectContaining({ allocations: expect.any(Array) }),
      trades: expect.objectContaining({ trades: expect.any(Array) }),
      metadata: expect.objectContaining({ modelTiers: ['opus', 'sonnet'] }),
    });
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2); // IN_PROGRESS + COMPLETED
  });

  it('should propagate orchestrator errors', async () => {
    mockInvokeOrchestrator.mockRejectedValue(new Error('Orchestrator failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Orchestrator failure');
  });
});
