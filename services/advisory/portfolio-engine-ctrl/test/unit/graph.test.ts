// services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
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
  formatStructuredOutputPrompt: jest.requireActual('@nestfolio/agent-orchestrator').formatStructuredOutputPrompt,
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
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [] },
      'rebalance-planner': { trades: [] },
    });
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test';
    process.env['MEMORY_ID'] = 'mem-test';
    process.env['TABLE_NAME'] = 'test-table';
  });
  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
    delete process.env['TABLE_NAME'];
  });

  it('builds an orchestrator with 2 parallel agents on first invocation', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(1);
    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(Object.keys(config.agents)).toEqual(['portfolio-construction', 'rebalance-planner']);
    expect(config.waves).toHaveLength(1);
    expect(config.waves[0].agents).toEqual(['portfolio-construction', 'rebalance-planner']);
  });

  it('caches the orchestrator per mode — same mode invoked twice rebuilds once', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });
    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd2',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('builds a separate orchestrator per mode', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: { operatingMode: 'CONSERVATIVE' },
    });
    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd2',
      upstreamOutputs: { operatingMode: 'AGGRESSIVE' },
    });

    expect(mockCreateOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('invokePortfolioEngine enriches input with KB context', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'VTI expense ratio 0.03%, tracks CRSP Total Market', score: 0.9 },
    ]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockKBRetrieve).toHaveBeenCalled();
    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.stringContaining('VTI expense ratio') }),
      undefined,
    );
  });

  it('invokePortfolioEngine injects portfolio snapshot into enriched input', async () => {
    mockKBRetrieve.mockResolvedValue([]);

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

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    const passedInput = mockInvokeOrchestrator.mock.calls[0][1].input as string;
    expect(passedInput).toContain('Portfolio snapshot:');
    expect(passedInput).toContain('"totalValue": 50000');
  });

  it('writes output to memory when every wave-node entry is ok:true', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ instrument: 'VTI' }] } },
      'rebalance-planner': { ok: true, output: { trades: [] } },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalledWith({
      'portfolio-construction': { allocations: [{ instrument: 'VTI' }] },
      'rebalance-planner': { trades: [] },
    });
  });

  it('skips Memory write when any wave-node entry is ok:false (Phase β fail-fast)', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ instrument: 'VTI' }] } },
      'rebalance-planner': { ok: false, reason: 'Error: timeout', fallback: { trades: [] } },
    });

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockMemorySession.writeAgentOutput).not.toHaveBeenCalled();
  });
});
