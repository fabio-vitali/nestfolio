export {};

const mockCreateOrchestrator = jest.fn();
const mockInvokeOrchestrator = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: mockCreateOrchestrator,
  invokeOrchestrator: mockInvokeOrchestrator,
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue({
      writeAgentOutput: jest.fn(),
      readUpstreamOutput: jest.fn().mockResolvedValue([]),
      searchLongTermMemory: jest.fn().mockResolvedValue([]),
    }),
    searchTenantMemory: jest.fn().mockResolvedValue([]),
  }),
}));

describe('advisory-ctrl decision-lifecycle agent graph', () => {
  beforeEach(() => jest.clearAllMocks());

  it('compiles and returns a response for a prompt', async () => {
    const mockGraph = { invoke: jest.fn() };
    mockCreateOrchestrator.mockReturnValue(mockGraph);
    mockInvokeOrchestrator.mockResolvedValue({
      'user-goals': { goalId: 'g1' },
      explainability: { explanation: 'Mocked decision lifecycle response.' },
    });

    let invokeDecisionLifecycle: (...args: unknown[]) => unknown;
    jest.isolateModules(() => {
      const mod = require('../agents/decision-lifecycle/graph');
      invokeDecisionLifecycle = mod.invokeDecisionLifecycle;
    });

    const result = await invokeDecisionLifecycle!({
      tenantId: 'tenant-123',
      decisionId: 'd1',
      input: 'Evaluate portfolio drift for tenant-123.',
    });

    expect(result).toHaveProperty('user-goals');
    expect(result).toHaveProperty('explainability');
  });
});
