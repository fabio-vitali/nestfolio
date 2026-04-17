export {};

const mockCreateOrchestrator = jest.fn();
const mockInvokeOrchestrator = jest.fn();
const mockCreateMemoryClient = jest.fn();

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: mockCreateOrchestrator,
  invokeOrchestrator: mockInvokeOrchestrator,
  createMemoryClient: mockCreateMemoryClient,
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue({
      writeAgentOutput: jest.fn(),
      readUpstreamOutput: jest.fn().mockResolvedValue([]),
      searchLongTermMemory: jest.fn().mockResolvedValue([]),
    }),
    searchTenantMemory: jest.fn().mockResolvedValue([]),
  }),
}));

// Imports removed — tested indirectly via jest.isolateModules + require()

describe('advisory-ctrl orchestrator graph', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates orchestrator with all 6 agents and 3 waves', () => {
    mockCreateOrchestrator.mockReturnValue({ invoke: jest.fn() });

    // Importing buildGraph triggers createOrchestrator
    jest.isolateModules(() => {
      require('../../../agents/decision-lifecycle/graph');
    });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(1);
    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(Object.keys(config.agents)).toHaveLength(6);
    expect(config.waves).toHaveLength(3);
    expect(config.waves[0].agents).toEqual(['user-goals', 'risk-assessment', 'market-research']);
    expect(config.waves[1].agents).toEqual(['portfolio-construction', 'rebalance-planner']);
    expect(config.waves[2].agents).toEqual(['explainability']);
  });

  it('passes validation rules and fallbacks', () => {
    mockCreateOrchestrator.mockReturnValue({ invoke: jest.fn() });

    jest.isolateModules(() => {
      require('../../../agents/decision-lifecycle/graph');
    });

    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(config.validationRules).toBeDefined();
    expect(config.fallbacks).toBeDefined();
    expect(Object.keys(config.validationRules)).toHaveLength(6);
    expect(Object.keys(config.fallbacks)).toHaveLength(6);
  });

  it('invokeDecisionLifecycle calls invokeOrchestrator with enriched input', async () => {
    const mockGraph = { invoke: jest.fn() };
    mockCreateOrchestrator.mockReturnValue(mockGraph);
    mockInvokeOrchestrator.mockResolvedValue({
      'user-goals': { goalId: 'g1' },
      'risk-assessment': { riskScore: 50 },
    });

    let invokeDecisionLifecycle: (...args: unknown[]) => unknown;
    jest.isolateModules(() => {
      const mod = require('../../../agents/decision-lifecycle/graph');
      invokeDecisionLifecycle = mod.invokeDecisionLifecycle;
    });

    const result = await invokeDecisionLifecycle!({
      tenantId: 't1',
      decisionId: 'd1',
      input: 'Analyze portfolio for moderate investor',
    });

    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      mockGraph,
      expect.objectContaining({ input: expect.any(String) }),
      expect.any(Object),
    );
    expect(result).toHaveProperty('user-goals');
  });
});
