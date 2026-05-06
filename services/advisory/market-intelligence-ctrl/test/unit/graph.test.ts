// services/advisory/market-intelligence-ctrl/test/graph.test.ts
const mockAgentNode = jest.fn();
const mockKBRetrieve = jest.fn();
const mockMemorySession = {
  writeAgentOutput: jest.fn(),
  readUpstreamOutput: jest.fn().mockResolvedValue([]),
  searchLongTermMemory: jest.fn().mockResolvedValue([]),
};

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(mockAgentNode),
  withValidation: jest.fn().mockImplementation((node) => node),
  withRetry: jest.fn().mockImplementation((node) => node),
  // After Phase β, withFallback returns AgentNodeResult discriminant.
  // Reproduce that contract here so the production graph code sees the
  // expected shape.
  withFallback: jest.fn().mockImplementation((node, fallbackFn) => async (state: Record<string, unknown>, cfg: unknown) => {
    try {
      const output = await node(state, cfg);
      return { ok: true, output };
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { ok: false, reason, fallback: fallbackFn(state) };
    }
  }),
  createKBClient: jest.fn().mockReturnValue({ retrieve: mockKBRetrieve }),
  createMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  invokeOrchestrator: jest.fn().mockImplementation(async (graph, input) => graph.invoke(input)),
  formatStructuredOutputPrompt: jest.requireActual('@nestfolio/agent-orchestrator').formatStructuredOutputPrompt,
}));

import { invokeMarketResearch } from '../../agents/market-intelligence/graph';

describe('market-intelligence-ctrl structured graph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test';
    process.env['MEMORY_ID'] = 'mem-test';
  });
  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
  });

  it('enriches input with KB context before agent invocation', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'Fed rate cut expected Q2 — equity tailwind', score: 0.88 },
    ]);
    mockAgentNode.mockResolvedValue({
      signals: [{ type: 'macro', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'fed-watch' }],
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish on rate cut expectations with solid earnings backdrop',
      confidenceScore: 0.82,
    });

    const result = await invokeMarketResearch({
      tenantId: 't1',
      decisionId: 'd1',
      upstreamOutputs: { investorProfile: { riskScore: 45 } },
    });

    // KB is seeded with JSON.stringify(upstreamOutputs)
    expect(mockKBRetrieve).toHaveBeenCalledWith(
      expect.stringContaining('investorProfile'),
      5,
    );
    expect(mockAgentNode).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('Fed rate cut expected'),
      }),
      undefined,
    );
    // Phase β: invokeMarketResearch now returns the discriminant-shaped
    // `{[agentKey]: AgentNodeResult}` envelope (uniform with createOrchestrator
    // services). The bare signals/marketOutlook live under .output.
    expect(result).toHaveProperty('market-research');
    expect((result as { 'market-research': { ok: boolean; output: { signals: unknown[] } } })['market-research'].output).toHaveProperty('signals');
  });

  it('writes output to memory', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      signals: [{ type: 'test', ticker: 'VTI', sentiment: 'NEUTRAL', confidence: 0.5, source: 'test' }],
      tickersMentioned: ['VTI'],
      marketOutlook: 'Neutral market conditions with mixed economic signals across sectors',
      confidenceScore: 0.6,
    });

    await invokeMarketResearch({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({ 'market-research': expect.objectContaining({ signals: expect.any(Array) }) }),
    );
  });

  it('injects market-data and instrument-universe into the agent prompt', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      signals: [],
      tickersMentioned: [],
      marketOutlook: 'neutral',
      confidenceScore: 0.5,
    });

    await invokeMarketResearch({
      tenantId: 't1',
      decisionId: 'd1',
      upstreamOutputs: { portfolioSnapshot: { totalValue: 100000 } },
    });

    const passedInput = (mockAgentNode.mock.calls[0][0] as { input: string }).input;
    expect(passedInput).toContain('Current market data:');
    expect(passedInput).toContain('Instrument universe:');
  });
});
