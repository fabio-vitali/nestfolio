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
    );
    expect(result).toHaveProperty('summary');
  });

  it('reads upstream memory context', async () => {
    mockMemorySession.readUpstreamOutput.mockResolvedValue([
      { content: 'portfolio-construction output', score: 0.95, memoryRecordId: 'r1' },
    ]);
    mockKBRetrieve.mockResolvedValue([]);
    mockAgentNode.mockResolvedValue({
      summary: 'Based on your portfolio construction.',
      rationale: 'Upstream context used.',
      keyFactors: ['upstream'],
      tone: 'reassuring',
      wordCount: 100,
      confidence: 0.85,
    });

    await invokeNarrative({
      tenantId: 't1',
      decisionId: 'd1',
      upstreamOutputs: { input: 'Explain decision' },
    });

    expect(mockMemorySession.readUpstreamOutput).toHaveBeenCalledWith('advisory-ctrl');
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
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });
});
