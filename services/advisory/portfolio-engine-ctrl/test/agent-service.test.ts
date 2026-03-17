const mockSend = jest.fn();
const mockInvokeOrchestrator = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
}));
jest.mock('@nestfolio/agent-core', () => ({
  createOrchestrator: jest.fn().mockReturnValue({ invoke: jest.fn() }),
  invokeOrchestrator: mockInvokeOrchestrator,
}));

import { createAgentService } from '../src/agent-service';

describe('portfolio-engine-ctrl agent-service', () => {
  const deps = {
    docClient: { send: mockSend } as any,
    tableName: 'test-table',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
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
    expect(mockSend).toHaveBeenCalledTimes(2); // IN_PROGRESS + COMPLETED
  });

  it('should propagate orchestrator errors', async () => {
    mockInvokeOrchestrator.mockRejectedValue(new Error('Orchestrator failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline({
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Orchestrator failure');
  });
});
