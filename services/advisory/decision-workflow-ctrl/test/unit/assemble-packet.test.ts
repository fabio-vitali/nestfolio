jest.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: jest.fn(),
  CreateEventCommand: jest.fn(),
  RetrieveMemoryRecordsCommand: jest.fn(),
}));

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
}));

jest.mock('@nestfolio/event-processor', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

jest.mock('../../src/repositories/decision-packet.repository', () => ({
  DecisionPacketRepository: jest.fn(),
}));

process.env.MEMORY_ID = 'mem-test';
process.env.TABLE_NAME = 'test-table';
// Short-circuit the Memory read-after-write retry waits in unit tests.
process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE = '0,0,0,0';

import { createAssemblePacketHandler } from '../../src/handlers/assemble-packet';

describe('assemble-packet handler', () => {
  const mockReadUpstream = jest.fn();
  const mockMemoryClient = {
    openDecisionSession: jest.fn(() => ({
      writeAgentOutput: jest.fn(),
      readUpstreamOutput: mockReadUpstream,
      searchLongTermMemory: jest.fn(),
    })),
    searchTenantMemory: jest.fn(),
  };
  const mockCreateDecisionPacket = jest.fn();
  const mockRepo = { createDecisionPacket: mockCreateDecisionPacket } as any;

  const handler = createAssemblePacketHandler({
    memoryClient: mockMemoryClient as any,
    decisionPacketRepository: mockRepo,
  });

  const baseEvent = {
    decisionId: 'dec-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    region: 'us-east-1',
    trigger: 'DEPOSIT_DETECTED',
    triggerEventId: 'dec-1',
    executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
  };

  beforeEach(() => {
    mockReadUpstream.mockReset();
    mockCreateDecisionPacket.mockReset();
    mockCreateDecisionPacket.mockResolvedValue(true);
  });

  it('reads agent outputs before creating DecisionPacket row, so explanation lands in the CDC INSERT event', async () => {
    const callOrder: string[] = [];
    mockReadUpstream.mockImplementation(async () => {
      callOrder.push('readUpstream');
      return [];
    });
    mockCreateDecisionPacket.mockImplementation(async () => {
      callOrder.push('createDecisionPacket');
      return true;
    });

    await handler(baseEvent);

    expect(callOrder.indexOf('readUpstream')).toBeLessThan(
      callOrder.indexOf('createDecisionPacket'),
    );
    expect(mockCreateDecisionPacket).toHaveBeenCalledTimes(1);
    expect(mockCreateDecisionPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'dec-1',
        trigger: 'DEPOSIT_DETECTED',
        triggerEventId: 'dec-1',
        executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
      }),
      { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
    );
  });

  it('persists narrative.explainability.rationale onto the DecisionPacket as explanation (regression: empty .rationale broke e2e step 10)', async () => {
    // AgentRuntime writes the orchestrator's raw output keyed by node name —
    // see advisory-narrative graph.ts:132. The Lambda's wrap-write was removed
    // (single-writer Memory contract). Explainability schema lives at
    // `narrativeOutput.explainability` post-Phase-7.
    mockReadUpstream.mockImplementation((svc: string) => {
      if (svc === 'advisory-narrative') {
        return Promise.resolve([
          {
            content: JSON.stringify({
              explainability: {
                summary: 'short framing',
                rationale: 'detailed reasoning behind the recommendation',
                keyFactors: ['factor-1'],
              },
            }),
            score: 1,
            memoryRecordId: 'r-narr',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await handler(baseEvent);

    expect(mockCreateDecisionPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        explanation: 'detailed reasoning behind the recommendation',
        proposedTrades: [],
        confirmationRequired: true,
      }),
      expect.anything(),
    );
  });

  it('falls back to narrative.explainability.summary when rationale is missing', async () => {
    mockReadUpstream.mockImplementation((svc: string) =>
      svc === 'advisory-narrative'
        ? Promise.resolve([
            { content: JSON.stringify({ explainability: { summary: 'fallback summary' } }), score: 1, memoryRecordId: 'r-s' },
          ])
        : Promise.resolve([]),
    );

    await handler(baseEvent);

    expect(mockCreateDecisionPacket).toHaveBeenCalledWith(
      expect.objectContaining({ explanation: 'fallback summary' }),
      expect.anything(),
    );
  });

  it('persists a non-empty placeholder explanation when narrative output is missing (covers Memory namespace mismatch)', async () => {
    mockReadUpstream.mockResolvedValue([]);

    await handler(baseEvent);

    const call = mockCreateDecisionPacket.mock.calls[0][0];
    expect(typeof call.explanation).toBe('string');
    expect(call.explanation.length).toBeGreaterThan(10);
    expect(call.explanation).toMatch(/DEPOSIT_DETECTED/);
  });

  it('reads all 4 upstream outputs from Memory', async () => {
    mockReadUpstream.mockResolvedValue([{ content: '{"test":true}', score: 1, memoryRecordId: 'r1' }]);

    const result = await handler(baseEvent);

    expect(mockReadUpstream).toHaveBeenCalledTimes(4);
    expect(mockReadUpstream).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstream).toHaveBeenCalledWith('market-intelligence');
    expect(mockReadUpstream).toHaveBeenCalledWith('portfolio-engine');
    expect(mockReadUpstream).toHaveBeenCalledWith('advisory-narrative');
    expect(result.investorProfileOutput).toEqual({ test: true });
  });

  it('returns null for missing outputs', async () => {
    mockReadUpstream.mockResolvedValue([]);

    const result = await handler(baseEvent);

    expect(result.investorProfileOutput).toBeNull();
    expect(result.marketAnalysisOutput).toBeNull();
  });

  it('returns safe-default compliance inputs when agents have not produced structured fields', async () => {
    mockReadUpstream.mockResolvedValue([]);

    const result = await handler(baseEvent);

    // Defaults align with the empty-trade / neutral-risk degenerate case so the
    // rule engine resolves APPROVED L1 (no exposure → no violation). When the
    // agents start emitting structured outputs, real values flow through.
    expect(result.proposedTrades).toEqual([]);
    expect(result.currentPositions).toEqual([]);
    expect(result.portfolioValue).toBe(0);
    expect(result.riskScore).toBe(5);
  });

  it('translates portfolio-engine allocations into proposedTrades', async () => {
    // AgentRuntime writes the orchestrator's raw output keyed by node name —
    // see services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:173.
    // The Lambda's wrap-write was removed (single-writer Memory contract),
    // so the PortfolioConstructionSchema lives at
    // `portfolioOutput['portfolio-construction']`. Phase 2 added `assetClass`
    // per allocation; assembler propagates it.
    mockReadUpstream.mockImplementation((svc: string) => {
      if (svc === 'portfolio-engine') {
        return Promise.resolve([
          {
            content: JSON.stringify({
              'portfolio-construction': {
                allocations: [
                  { instrument: 'AAPL', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'Growth' },
                  { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: 'Ballast' },
                ],
                totalExposure: 100_000,
                equityWeight: 0.6,
                riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.7, largestPositionWeight: 0.6 },
                confidence: 0.85,
              },
              'rebalance-planner': {
                trades: [],
                estimatedTurnover: 0.1,
                confidence: 0.8,
              },
            }),
            score: 1,
            memoryRecordId: 'r1',
          },
        ]);
      }
      if (svc === 'investor-profile') {
        return Promise.resolve([
          { content: JSON.stringify({ riskScore: 7 }), score: 1, memoryRecordId: 'r2' },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await handler(baseEvent);

    expect(result.proposedTrades).toEqual([
      { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 6_000_000, targetWeightPercent: 60, rationale: 'Growth' },
      { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 4_000_000, targetWeightPercent: 40, rationale: 'Ballast' },
    ]);
    expect(result.portfolioValue).toBe(100_000);
    expect(result.riskScore).toBe(7);
  });
});
