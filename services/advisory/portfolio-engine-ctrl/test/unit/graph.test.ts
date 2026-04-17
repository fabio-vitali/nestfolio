// services/advisory/portfolio-engine-ctrl/test/graph.test.ts
const mockCreateOrchestrator = jest.fn();
const mockInvokeOrchestrator = jest.fn();
const mockKBRetrieve = jest.fn();
const mockMemorySession = {
  writeAgentOutput: jest.fn(),
  readUpstreamOutput: jest.fn().mockResolvedValue([]),
  searchLongTermMemory: jest.fn().mockResolvedValue([]),
};

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createOrchestrator: mockCreateOrchestrator,
  invokeOrchestrator: mockInvokeOrchestrator,
  createKBClient: jest.fn().mockReturnValue({ retrieve: mockKBRetrieve }),
  createMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
}));

describe('portfolio-engine-ctrl orchestrator graph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOrchestrator.mockReturnValue({ invoke: jest.fn() });
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test';
    process.env['MEMORY_ID'] = 'mem-test';
  });
  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
  });

  it('creates orchestrator with 2 parallel agents', () => {
    jest.isolateModules(() => {
      require('../../agents/graph');
    });

    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(Object.keys(config.agents)).toEqual(['portfolio-construction', 'rebalance-planner']);
    expect(config.waves).toHaveLength(1);
    expect(config.waves[0].agents).toEqual(['portfolio-construction', 'rebalance-planner']);
  });

  it('invokePortfolioEngine enriches input with KB context', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'VTI expense ratio 0.03%, tracks CRSP Total Market', score: 0.9 },
    ]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [] },
      'rebalance-planner': { trades: [] },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1', input: 'Construct portfolio',
    });

    expect(mockKBRetrieve).toHaveBeenCalled();
    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.stringContaining('VTI expense ratio') }),
      expect.any(Object),
    );
  });

  it('writes output to memory', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [{ instrument: 'VTI' }] },
      'rebalance-planner': { trades: [] },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1', input: 'Build',
    });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalled();
  });
});
