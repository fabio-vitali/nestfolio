jest.mock('@nestfolio/event-processor', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

jest.mock('../../src/repositories/decision-packet.repository', () => ({
  DecisionPacketRepository: jest.fn(),
}));

process.env.TABLE_NAME = 'test-table';

import { createAssemblePacketHandler } from '../../src/handlers/assemble-packet';

describe('assemble-packet handler', () => {
  const mockCreateDecisionPacket = jest.fn();
  const mockRepo = { createDecisionPacket: mockCreateDecisionPacket } as any;

  const handler = createAssemblePacketHandler({
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
    mockCreateDecisionPacket.mockReset();
    mockCreateDecisionPacket.mockResolvedValue(true);
  });

  it('creates the DecisionPacket row with the standard ctx so the CDC INSERT carries explanation + tenantId', async () => {
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: null,
    });

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
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: {
        explainability: {
          summary: 'short framing',
          rationale: 'detailed reasoning behind the recommendation',
          keyFactors: ['factor-1'],
        },
      },
    });

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
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: { explainability: { summary: 'fallback summary' } },
    });

    expect(mockCreateDecisionPacket).toHaveBeenCalledWith(
      expect.objectContaining({ explanation: 'fallback summary' }),
      expect.anything(),
    );
  });

  it('persists a non-empty placeholder explanation when narrative output is missing (covers degraded-agent-output path)', async () => {
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: null,
    });

    const call = mockCreateDecisionPacket.mock.calls[0][0];
    expect(typeof call.explanation).toBe('string');
    expect(call.explanation.length).toBeGreaterThan(10);
    expect(call.explanation).toMatch(/DEPOSIT_DETECTED/);
  });

  it('passes the 4 agent outputs through to the result envelope', async () => {
    const result = await handler({
      ...baseEvent,
      investorProfile: { test: true },
      marketAnalysis: { test: true },
      portfolio: { test: true },
      narrative: { test: true },
    });

    expect(result.investorProfileOutput).toEqual({ test: true });
    expect(result.marketAnalysisOutput).toEqual({ test: true });
    expect(result.portfolioOutput).toEqual({ test: true });
    expect(result.narrativeOutput).toEqual({ test: true });
  });

  it('returns null for missing outputs', async () => {
    const result = await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: null,
    });

    expect(result.investorProfileOutput).toBeNull();
    expect(result.marketAnalysisOutput).toBeNull();
    expect(result.portfolioOutput).toBeNull();
    expect(result.narrativeOutput).toBeNull();
  });

  it('returns safe-default compliance inputs when agents have not produced structured fields', async () => {
    const result = await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: null,
    });

    // Defaults align with the empty-trade / neutral-risk degenerate case so the
    // rule engine resolves APPROVED L1 (no exposure → no violation). When the
    // agents start emitting structured outputs, real values flow through.
    expect(result.proposedTrades).toEqual([]);
    expect(result.currentPositions).toEqual([]);
    expect(result.portfolioValue).toBe(0);
    expect(result.riskScore).toBe(5);
  });

  it('translates portfolio-engine allocations into proposedTrades (post-Phase-A shape)', async () => {
    // Phase A migrated inter-agent handoff to SF state.
    // portfolio-engine-ctrl/src/agent-service.ts returns top-level
    // { decisionId, allocations, trades, metadata } — the LangGraph node-keyed
    // outputs (portfolio-construction / rebalance-planner) are renamed by the
    // agent-service layer before they reach SF state. The handler must read
    // portfolio.allocations.allocations, NOT portfolio['portfolio-construction'].allocations.
    const result = await handler({
      ...baseEvent,
      investorProfile: { riskScore: 7 },
      marketAnalysis: null,
      portfolio: {
        decisionId: 'd-1',
        allocations: {
          allocations: [
            { instrument: 'AAPL', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'Growth' },
            { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: 'Ballast' },
          ],
          totalExposure: 100_000,
          equityWeight: 0.6,
          riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.7, largestPositionWeight: 0.6 },
          confidence: 0.85,
        },
        trades: {
          trades: [],
          estimatedTurnover: 0.1,
          confidence: 0.8,
        },
        metadata: { durationMs: 1234, modeUsed: 'BALANCED' },
      },
      narrative: null,
    });

    expect(result.proposedTrades).toEqual([
      { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 6_000_000, targetWeightPercent: 60, rationale: 'Growth' },
      { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 4_000_000, targetWeightPercent: 40, rationale: 'Ballast' },
    ]);
    expect(result.portfolioValue).toBe(100_000);
    expect(result.riskScore).toBe(7);
  });

  it('falls back to placeholder when all upstream agent outputs are null (defence-in-depth)', async () => {
    const result = await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: null,
    });

    expect(result.proposedTrades).toEqual([]);
    const call = mockCreateDecisionPacket.mock.calls[0][0];
    expect(call.explanation).toMatch(/Decision pending/);
  });
});
