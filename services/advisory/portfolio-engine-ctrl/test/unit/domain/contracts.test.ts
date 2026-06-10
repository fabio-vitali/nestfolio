import { PortfolioAgentOutputSchema } from '../../../src/domain/contracts';

describe('portfolio-engine-ctrl contracts', () => {
  it('PortfolioAgentOutputSchema parses the composite runPipeline output', () => {
    const parsed = PortfolioAgentOutputSchema.parse({
      decisionId: 'd1',
      allocations: {
        allocations: [{ instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'core holding' }],
        totalExposure: 1,
        equityWeight: 0.6,
        riskMetrics: { concentrationRisk: 0.1, sectorDiversity: 0.8, largestPositionWeight: 0.6 },
        confidence: 0.9,
      },
      trades: {
        trades: [{ action: 'BUY', instrument: 'VTI', targetWeight: 0.6, currentWeight: 0, quantity: 10, rationale: 'initiate' }],
        estimatedTurnover: 0.6,
        confidence: 0.9,
      },
      metadata: { durationMs: 1200, modelTiers: ['opus', 'sonnet'], modeUsed: 'BALANCED' },
    });
    expect(parsed.decisionId).toBe('d1');
    expect(parsed.allocations.allocations[0].instrument).toBe('VTI');
    expect(parsed.metadata.modelTiers).toEqual(['opus', 'sonnet']);
  });

  it('PortfolioAgentOutputSchema tolerates an absent optional trades block', () => {
    const parsed = PortfolioAgentOutputSchema.parse({
      decisionId: 'd1',
      allocations: {
        allocations: [],
        totalExposure: 1,
        equityWeight: 0.6,
        riskMetrics: { concentrationRisk: 0, sectorDiversity: 0, largestPositionWeight: 0 },
        confidence: 0.9,
      },
      metadata: { durationMs: 1 },
    });
    expect(parsed.trades).toBeUndefined();
  });

  it('PortfolioAgentOutputSchema passes through unknown metadata keys', () => {
    const parsed = PortfolioAgentOutputSchema.parse({
      decisionId: 'd1',
      allocations: {
        allocations: [],
        totalExposure: 1,
        equityWeight: 0,
        riskMetrics: { concentrationRisk: 0, sectorDiversity: 0, largestPositionWeight: 0 },
        confidence: 0.5,
      },
      metadata: { durationMs: 500, extraKey: 'extra-value' },
    });
    expect((parsed.metadata as Record<string, unknown>).extraKey).toBe('extra-value');
  });
});
