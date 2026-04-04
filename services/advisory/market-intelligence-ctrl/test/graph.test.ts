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
  withFallback: jest.fn().mockImplementation((node) => node),
  createKBClient: jest.fn().mockReturnValue({ retrieve: mockKBRetrieve }),
  createMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
}));

import { invokeMarketResearch } from '../agents/graph';

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
      input: 'Analyze market conditions',
    });

    expect(mockKBRetrieve).toHaveBeenCalledWith(expect.stringContaining('Analyze market'), 5);
    expect(mockAgentNode).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('Fed rate cut expected'),
      }),
    );
    expect(result).toHaveProperty('signals');
  });

  it('writes output to memory', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      signals: [{ type: 'test', ticker: 'VTI', sentiment: 'NEUTRAL', confidence: 0.5, source: 'test' }],
      tickersMentioned: ['VTI'],
      marketOutlook: 'Neutral market conditions with mixed economic signals across sectors',
      confidenceScore: 0.6,
    });

    await invokeMarketResearch({ tenantId: 't1', decisionId: 'd1', input: 'Analyze' });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalled();
  });
});
