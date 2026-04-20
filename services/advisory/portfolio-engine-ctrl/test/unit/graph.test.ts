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

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({}) },
}));

jest.mock('../../src/agents/tools/portfolio-lookup', () => ({
  createPortfolioLookup: jest.fn().mockReturnValue(async () => null),
}));

describe('portfolio-engine-ctrl orchestrator graph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOrchestrator.mockReturnValue({ invoke: jest.fn() });
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test';
    process.env['MEMORY_ID'] = 'mem-test';
    process.env['TABLE_NAME'] = 'test-table';
  });
  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
    delete process.env['TABLE_NAME'];
  });

  it('creates orchestrator with 2 parallel agents', () => {
    jest.isolateModules(() => {
      require('../../agents/portfolio-engine/graph');
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
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1', input: 'Construct portfolio',
    });

    expect(mockKBRetrieve).toHaveBeenCalled();
    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.stringContaining('VTI expense ratio') }),
      undefined,
    );
  });

  it('invokePortfolioEngine injects portfolio snapshot into enriched input', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [] },
      'rebalance-planner': { trades: [] },
    });

    const snapshot = {
      tenantId: 't1',
      snapshot: { totalValue: 50000, holdings: [{ instrument: 'VTI', weight: 0.6 }] },
    };

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../src/agents/tools/portfolio-lookup', () => ({
        createPortfolioLookup: () => async () => snapshot,
      }));
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', input: 'Rebalance' });

    const passedInput = mockInvokeOrchestrator.mock.calls[0][1].input as string;
    expect(passedInput).toContain('Portfolio snapshot:');
    expect(passedInput).toContain('"totalValue": 50000');
  });

  it('writes output to memory', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [{ instrument: 'VTI' }] },
      'rebalance-planner': { trades: [] },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1', input: 'Build',
    });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalled();
  });
});
