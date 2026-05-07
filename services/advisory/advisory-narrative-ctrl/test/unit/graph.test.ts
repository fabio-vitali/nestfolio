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

import { invokeNarrative } from '../../agents/advisory-narrative/graph';

describe('advisory-narrative-ctrl structured graph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['KNOWLEDGE_BASE_ID'] = 'test-kb-id';
    process.env['MEMORY_ID'] = 'test-memory-id';
  });

  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['MEMORY_ID'];
  });

  it('enriches input with KB context before agent invocation', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'Template: Use simple language for new investors', score: 0.9 },
    ]);
    mockAgentNode.mockResolvedValue({
      summary: 'Your portfolio was rebalanced.',
      rationale: 'Market drift correction.',
      keyFactors: ['drift'],
      tone: 'educational',
      wordCount: 50,
      confidence: 0.8,
    });

    const result = await invokeNarrative({
      tenantId: 't1',
      decisionId: 'd1',
      upstreamOutputs: { input: 'Explain rebalance' },
    });

    expect(mockKBRetrieve).toHaveBeenCalledWith(expect.stringContaining('Explain rebalance'), 3);
    expect(mockAgentNode).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('Template: Use simple language'),
      }),
      undefined,
    );
    // Phase β: invokeNarrative now returns the discriminant-shaped
    // `{[agentKey]: AgentNodeResult}` envelope (uniform with createOrchestrator
    // services). The bare summary lives under .output.
    expect(result).toHaveProperty('explainability');
    expect((result as { explainability: { ok: boolean; output: { summary: string } } }).explainability.output).toHaveProperty('summary');
  });

  it('writes output to memory after successful invocation', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      summary: 'Summary here for testing writing.',
      rationale: 'Rationale here for testing.',
      keyFactors: ['factor'],
      tone: 'neutral',
      wordCount: 50,
      confidence: 0.7,
    });

    await invokeNarrative({
      tenantId: 't1',
      decisionId: 'd1',
      upstreamOutputs: { input: 'Explain' },
    });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        explainability: expect.objectContaining({ summary: expect.any(String) }),
      }),
    );
  });
});
