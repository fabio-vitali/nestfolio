// services/advisory/investor-profile-ctrl/test/graph.test.ts
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

describe('investor-profile-ctrl orchestrator graph', () => {
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

  it('creates orchestrator with 2 parallel agents (user-goals + risk-assessment)', () => {
    jest.isolateModules(() => {
      require('../../agents/graph');
    });

    const config = mockCreateOrchestrator.mock.calls[0][0];
    expect(Object.keys(config.agents)).toEqual(['user-goals', 'risk-assessment']);
    expect(config.waves).toHaveLength(1);
    expect(config.waves[0].agents).toEqual(['user-goals', 'risk-assessment']);
  });

  it('invokeInvestorProfile enriches input with KB + memory context', async () => {
    mockKBRetrieve.mockResolvedValue([
      { text: 'FINRA 2111 suitability: reasonable-basis obligation', score: 0.91 },
    ]);
    mockInvokeOrchestrator.mockResolvedValue({
      'user-goals': { goals: ['retirement'], confidence: 0.9 },
      'risk-assessment': { riskScore: 45, confidence: 0.85 },
    });

    let invokeInvestorProfile: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/graph');
      invokeInvestorProfile = mod.invokeInvestorProfile;
    });

    await invokeInvestorProfile!({
      tenantId: 't1', decisionId: 'd1', input: 'Analyze investor profile',
    });

    expect(mockKBRetrieve).toHaveBeenCalled();
    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.stringContaining('FINRA 2111') }),
      expect.any(Object),
    );
  });

  it('writes output to memory', async () => {
    mockKBRetrieve.mockResolvedValue([]);
    mockInvokeOrchestrator.mockResolvedValue({
      'user-goals': { goals: ['growth'] },
      'risk-assessment': { riskScore: 60 },
    });

    let invokeInvestorProfile: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/graph');
      invokeInvestorProfile = mod.invokeInvestorProfile;
    });

    await invokeInvestorProfile!({ tenantId: 't1', decisionId: 'd1', input: 'Analyze' });

    expect(mockMemorySession.writeAgentOutput).toHaveBeenCalled();
  });
});
