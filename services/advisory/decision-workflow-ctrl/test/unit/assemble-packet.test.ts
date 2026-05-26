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

  it('persists narrative.rationale onto the DecisionPacket as explanation (regression: agent-service.ts:143 spreads explainability at top level — placeholder fired on every decision before the fix)', async () => {
    // Mirrors advisory-narrative-ctrl/src/agent-service.ts:143:
    //   return { decisionId, ...explainability, metadata: {...} }
    // → SF state carries narrative.{rationale,summary,keyFactors} directly,
    // NOT under narrative.explainability.*
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: {
        decisionId: 'dec-1',
        summary: 'short framing',
        rationale: 'detailed reasoning behind the recommendation',
        keyFactors: ['factor-1'],
        metadata: { durationMs: 1234, modelTier: 'haiku' },
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

  it('falls back to narrative.summary when rationale is missing', async () => {
    await handler({
      ...baseEvent,
      investorProfile: null,
      marketAnalysis: null,
      portfolio: null,
      narrative: { decisionId: 'dec-1', summary: 'fallback summary', metadata: { durationMs: 1, modelTier: 'haiku' } },
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
    expect(result.portfolioValueCents).toBe(0);
    expect(result.riskCategory).toBe('MODERATE');
  });

  it('translates portfolio-engine allocations into proposedTrades (post-Phase-A shape)', async () => {
    // Phase A migrated inter-agent handoff to SF state.
    // portfolio-engine-ctrl/src/agent-service.ts returns top-level
    // { decisionId, allocations, trades, metadata } — the LangGraph node-keyed
    // outputs (portfolio-construction / rebalance-planner) are renamed by the
    // agent-service layer before they reach SF state. The handler must read
    // portfolio.allocations.allocations, NOT portfolio['portfolio-construction'].allocations.
    // quantityOrAmountCents = round(targetWeight * portfolioValueCents) — real cents,
    // NOT the old round(targetWeight * totalExposure * 100) basis-point formula.
    const result = await handler({
      ...baseEvent,
      triggerAmountCents: 100_000, // $1000 deposit — the source of portfolioValueCents
      investorProfile: { riskCategory: 'AGGRESSIVE' },
      marketAnalysis: null,
      portfolio: {
        decisionId: 'd-1',
        allocations: {
          allocations: [
            { instrument: 'AAPL', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'Growth' },
            { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: 'Ballast' },
          ],
          totalExposure: 1, // normalization indicator — NOT used for portfolioValueCents
          equityWeight: 0.6,
          riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.7, largestPositionWeight: 0.6 },
          confidence: 0.85,
        },
        trades: {
          trades: [],
          estimatedTurnover: 0.1,
          confidence: 0.8,
        },
        currentPositions: [],
        metadata: { durationMs: 1234, modeUsed: 'BALANCED' },
      },
      narrative: null,
    });

    expect(result.proposedTrades).toEqual([
      { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 60_000, targetWeightPercent: 60, rationale: 'Growth' },
      { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 40_000, targetWeightPercent: 40, rationale: 'Ballast' },
    ]);
    expect(result.portfolioValueCents).toBe(100_000);
    expect(result.riskCategory).toBe('AGGRESSIVE');
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

  describe('canonical cents + initial-build + riskCategory (decision-pipeline workstream)', () => {
    it('portfolioValueCents derives from triggerAmountCents alone when positions are empty', async () => {
      const result = await handler({
        ...baseEvent,
        triggerAmountCents: 100_000, // $1000 deposit
        investorProfile: { riskCategory: 'MODERATE' },
        marketAnalysis: null,
        portfolio: {
          allocations: {
            allocations: [
              { instrument: 'VTI', targetWeight: 0.14, assetClass: 'EQUITY', rationale: 'Core US' },
            ],
            totalExposure: 1,
          },
          currentPositions: [],
        },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      });
      expect(result.portfolioValueCents).toBe(100_000);
      expect(result.proposedTrades).toHaveLength(1);
      // Real cents now: 0.14 * 100_000 = 14_000 (was 14 under the bug)
      expect(result.proposedTrades[0].quantityOrAmountCents).toBe(14_000);
      expect(result.proposedTrades[0].targetWeightPercent).toBeCloseTo(14);
    });

    it('portfolioValueCents adds existing positions value to triggerAmountCents', async () => {
      const result = await handler({
        ...baseEvent,
        triggerAmountCents: 50_000, // $500 additional deposit
        investorProfile: { riskCategory: 'AGGRESSIVE' },
        marketAnalysis: null,
        ledgerSnapshot: {
          positions: {
            VTI: { quantity: 4, lastFillPrice: 500 }, // 4 * 500 * 100 = 200_000c
            BND: { quantity: 2, lastFillPrice: 500 }, // 2 * 500 * 100 = 100_000c
          },
          cashBalanceCents: 0,
        },
        portfolio: {
          allocations: { allocations: [], totalExposure: 1 },
        },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      } as any);
      expect(result.portfolioValueCents).toBe(350_000); // 200k + 100k + 50k
      expect(result.isInitialBuild).toBe(false);
    });

    it('isInitialBuild is true when currentPositions is empty', async () => {
      const result = await handler({
        ...baseEvent,
        triggerAmountCents: 100_000,
        investorProfile: { riskCategory: 'MODERATE' },
        marketAnalysis: null,
        portfolio: { allocations: { allocations: [], totalExposure: 1 }, currentPositions: [] },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      });
      expect(result.isInitialBuild).toBe(true);
    });

    it('isInitialBuild is false when currentPositions has at least one entry', async () => {
      const result = await handler({
        ...baseEvent,
        triggerAmountCents: 0,
        investorProfile: { riskCategory: 'MODERATE' },
        marketAnalysis: null,
        ledgerSnapshot: {
          positions: { VTI: { quantity: 2, lastFillPrice: 500 } },
          cashBalanceCents: 0,
        },
        portfolio: {
          allocations: { allocations: [], totalExposure: 1 },
        },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      } as any);
      expect(result.isInitialBuild).toBe(false);
    });

    it('riskCategory falls back to MODERATE when investorProfile lacks riskCategory', async () => {
      const result = await handler({
        ...baseEvent,
        triggerAmountCents: 100_000,
        investorProfile: {}, // no riskCategory
        marketAnalysis: null,
        portfolio: { allocations: { allocations: [], totalExposure: 1 }, currentPositions: [] },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      });
      expect(result.riskCategory).toBe('MODERATE');
    });

    it('riskCategory passes through CONSERVATIVE | MODERATE | AGGRESSIVE from investorProfile', async () => {
      for (const cat of ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'] as const) {
        const result = await handler({
          ...baseEvent,
          triggerAmountCents: 100_000,
          investorProfile: { riskCategory: cat },
          marketAnalysis: null,
          portfolio: { allocations: { allocations: [], totalExposure: 1 }, currentPositions: [] },
          narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
        });
        expect(result.riskCategory).toBe(cat);
      }
    });

    it('portfolioValueCents=0 (no triggerAmountCents, no positions) yields no trades and no crash', async () => {
      // Delta logic: targetCents = round(0.5 * 0) = 0, currentCents = 0, delta = 0 → skipped.
      // Zero-cent trades are meaningless under delta semantics; the important invariant is
      // that the handler completes without throwing and returns an empty proposedTrades array.
      const result = await handler({
        ...baseEvent,
        investorProfile: { riskCategory: 'MODERATE' },
        marketAnalysis: null,
        portfolio: {
          allocations: {
            allocations: [{ instrument: 'VTI', targetWeight: 0.5, assetClass: 'EQUITY', rationale: 'x' }],
            totalExposure: 1,
          },
          currentPositions: [],
        },
        narrative: { decisionId: 'dec-1', rationale: 'ok', metadata: {} },
      });
      expect(result.portfolioValueCents).toBe(0);
      expect(result.proposedTrades).toEqual([]);
    });
  });
});

import { __INTERNAL__ as ap } from '../../src/handlers/assemble-packet';

describe('assemble-packet — indexing helpers', () => {
  it('normalizes target symbols (trim + uppercase) and skips CASH/blank', () => {
    const targets = ap.indexTargets([
      { instrument: 'vti ', assetClass: 'EQUITY', targetWeight: 0.6, rationale: '' },
      { instrument: '  BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: '' },
      { instrument: 'CASH', assetClass: 'CASH', targetWeight: 0.1, rationale: '' },  // dropped
      { instrument: '', assetClass: 'EQUITY', targetWeight: 0.1, rationale: '' },    // dropped
    ]);
    expect([...targets.keys()].sort()).toEqual(['BND', 'VTI']);
    expect(targets.get('VTI')?.targetWeight).toBe(0.6);
  });

  it('indexes currentPositions by symbol', () => {
    const current = ap.indexCurrent([
      { symbol: 'VTI', quantity: 10, marketValueCents: 200_000 },
    ]);
    expect(current.get('VTI')?.marketValueCents).toBe(200_000);
  });
});

describe('assemble-packet — ledgerSnapshot integration', () => {
  const mockCreateDecisionPacket = jest.fn();
  const mockRepo = { createDecisionPacket: mockCreateDecisionPacket } as any;

  const handler = createAssemblePacketHandler({
    decisionPacketRepository: mockRepo,
  });

  const baseEventDefaults = {
    decisionId: 'dec-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    region: 'us-east-1',
    trigger: 'DEPOSIT_DETECTED',
    triggerEventId: 'dec-1',
    executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
    investorProfile: null,
    marketAnalysis: null,
    narrative: null,
  };

  const baseEvent = (overrides: Record<string, unknown>) => ({ ...baseEventDefaults, ...overrides });

  beforeEach(() => {
    mockCreateDecisionPacket.mockReset();
    mockCreateDecisionPacket.mockResolvedValue(true);
  });

  it('computes currentPositions from ledgerSnapshot.positions, dropping zero-quantity entries', async () => {
    const event = baseEvent({
      ledgerSnapshot: {
        positions: {
          VTI: { quantity: 10, lastFillPrice: 200 },     // 200_000c
          BND: { quantity: 50, lastFillPrice: 80 },      //  400_000c
          ZERO: { quantity: 0, lastFillPrice: 100 },     // dropped
        },
        cashBalanceCents: 100_000,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: [] },
    });
    const out = await handler(event as any);
    expect(out.currentPositions).toEqual([
      { symbol: 'VTI', quantity: 10, marketValueCents: 200_000 },
      { symbol: 'BND', quantity: 50, marketValueCents: 400_000 },
    ]);
    expect(out.portfolioValueCents).toBe(200_000 + 400_000 + 100_000);
    expect(out.isInitialBuild).toBe(false);
  });

  it('treats empty positions as initial build and uses cash + trigger as portfolioValue', async () => {
    const event = baseEvent({
      ledgerSnapshot: { positions: {}, cashBalanceCents: 0 },
      triggerAmountCents: 5_000_000,
      portfolio: { allocations: [] },
    });
    const out = await handler(event as any);
    expect(out.currentPositions).toEqual([]);
    expect(out.portfolioValueCents).toBe(5_000_000);
    expect(out.isInitialBuild).toBe(true);
  });
});

describe('assemble-packet — delta proposedTrades', () => {
  const mockCreateDecisionPacket = jest.fn();
  const mockRepo = { createDecisionPacket: mockCreateDecisionPacket } as any;

  const handler = createAssemblePacketHandler({
    decisionPacketRepository: mockRepo,
  });

  const baseEventDefaults = {
    decisionId: 'dec-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    region: 'us-east-1',
    trigger: 'DEPOSIT_DETECTED',
    triggerEventId: 'dec-1',
    executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
    investorProfile: null,
    marketAnalysis: null,
    narrative: null,
  };

  const baseEvent = (overrides: Record<string, unknown>) => ({ ...baseEventDefaults, ...overrides });

  beforeEach(() => {
    mockCreateDecisionPacket.mockReset();
    mockCreateDecisionPacket.mockResolvedValue(true);
  });

  it('BUYs symbols in target but not held, sized at full target', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: { positions: {}, cashBalanceCents: 10_000_00 },
      triggerAmountCents: 0,
      portfolio: { allocations: { allocations: [
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'r' },
      ] }},
    }) as any);
    expect(out.proposedTrades).toEqual([
      expect.objectContaining({ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 6_000_00, targetWeightPercent: 60 }),
    ]);
  });

  it('BUYs when target > current and SELLs when target < current', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        // 100_000 cash + VTI@200_000c + BND@200_000c = 500_000c portfolio.
        positions: {
          VTI: { quantity: 10, lastFillPrice: 200 },   // currentCents 200_000
          BND: { quantity: 25, lastFillPrice: 80 },    // currentCents 200_000
        },
        cashBalanceCents: 100_000,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: { allocations: [
        // target VTI 80% = 400_000c → BUY 200_000c
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.8, rationale: '' },
        // target BND 20% = 100_000c → SELL 100_000c
        { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.2, rationale: '' },
      ] }},
    }) as any);
    const vti = out.proposedTrades.find((t: any) => t.symbol === 'VTI')!;
    const bnd = out.proposedTrades.find((t: any) => t.symbol === 'BND')!;
    expect(vti).toMatchObject({ side: 'BUY', quantityOrAmountCents: 200_000, targetWeightPercent: 80 });
    expect(bnd).toMatchObject({ side: 'SELL', quantityOrAmountCents: 100_000, targetWeightPercent: 20 });
  });

  it('emits a full SELL for symbols held but not in target', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        positions: { OLD: { quantity: 5, lastFillPrice: 100 } },   // 50_000c
        cashBalanceCents: 0,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: { allocations: [
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 1.0, rationale: '' },
      ] }},
    }) as any);
    const old = out.proposedTrades.find((t: any) => t.symbol === 'OLD')!;
    expect(old).toMatchObject({ side: 'SELL', quantityOrAmountCents: 50_000, targetWeightPercent: 0 });
  });
});

describe('assemble-packet — micro-trade filter + ordering', () => {
  const mockCreateDecisionPacket = jest.fn();
  const mockRepo = { createDecisionPacket: mockCreateDecisionPacket } as any;

  const handler = createAssemblePacketHandler({
    decisionPacketRepository: mockRepo,
  });

  const baseEventDefaults = {
    decisionId: 'dec-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    region: 'us-east-1',
    trigger: 'DEPOSIT_DETECTED',
    triggerEventId: 'dec-1',
    executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
    investorProfile: null,
    marketAnalysis: null,
    narrative: null,
  };

  const baseEvent = (overrides: Record<string, unknown>) => ({ ...baseEventDefaults, ...overrides });

  beforeEach(() => {
    mockCreateDecisionPacket.mockReset();
    mockCreateDecisionPacket.mockResolvedValue(true);
  });

  it('drops trades whose quantityOrAmountCents is < 1% of portfolioValueCents', async () => {
    // VTI@200/share, 1000 shares → 1000*200*100 = 20_000_000c portfolio (no cash).
    // Target VTI 99.5% of 20_000_000 = 19_900_000c; current 20_000_000c.
    // Delta = -100_000c. Epsilon (1% of 20_000_000) = 200_000c. Delta below epsilon → drop.
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        positions: { VTI: { quantity: 1000, lastFillPrice: 200 } },
        cashBalanceCents: 0,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: { allocations: [
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.995, rationale: '' },
      ] }},
    }) as any);
    expect(out.proposedTrades).toEqual([]);
  });

  it('orders SELLs before BUYs, then by symbol ascending', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        positions: {
          AAA: { quantity: 100, lastFillPrice: 100 },   // 1_000_000c
          ZZZ: { quantity: 100, lastFillPrice: 100 },   // 1_000_000c
        },
        cashBalanceCents: 10_000_000,                   // portfolioValue = 12_000_000c
      },
      triggerAmountCents: 0,
      portfolio: { allocations: { allocations: [
        // VTI target 50% = 6_000_000c, not held → BUY 6_000_000c
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.5, rationale: '' },
        // AAA target 25% = 3_000_000c, current 1_000_000c → BUY 2_000_000c
        { instrument: 'AAA', assetClass: 'EQUITY', targetWeight: 0.25, rationale: '' },
        // ZZZ not in target → full SELL 1_000_000c
      ] }},
    }) as any);
    const sides = out.proposedTrades.map((t: any) => `${t.side}:${t.symbol}`);
    expect(sides).toEqual(['SELL:ZZZ', 'BUY:AAA', 'BUY:VTI']);
  });
});
