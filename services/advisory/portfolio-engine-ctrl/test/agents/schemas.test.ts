import { PortfolioConstructionSchema, RebalancePlanSchema } from '../../src/agents/schemas';

describe('PortfolioConstructionSchema', () => {
  const validData = {
    allocations: [
      { instrument: 'VTI', targetWeight: 0.6, rationale: 'US equity core' },
      { instrument: 'BND', targetWeight: 0.4, rationale: 'Fixed income' },
    ],
    totalExposure: 1.0,
    riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.7 },
    confidence: 0.85,
  };

  it('accepts valid data', () => {
    expect(PortfolioConstructionSchema.safeParse(validData).success).toBe(true);
  });

  it('rejects targetWeight > 1', () => {
    expect(PortfolioConstructionSchema.safeParse({
      ...validData,
      allocations: [{ instrument: 'VTI', targetWeight: 1.5, rationale: 'Too much' }],
    }).success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    expect(PortfolioConstructionSchema.safeParse({ ...validData, confidence: 1.5 }).success).toBe(false);
  });
});

describe('RebalancePlanSchema', () => {
  const validData = {
    trades: [
      { action: 'BUY' as const, instrument: 'VTI', targetWeight: 0.6, currentWeight: 0.5, quantity: 10, rationale: 'Increase equity' },
    ],
    estimatedTurnover: 0.1,
    confidence: 0.8,
  };

  it('accepts valid data', () => {
    expect(RebalancePlanSchema.safeParse(validData).success).toBe(true);
  });

  it('rejects invalid action', () => {
    expect(RebalancePlanSchema.safeParse({
      ...validData,
      trades: [{ ...validData.trades[0], action: 'SWAP' }],
    }).success).toBe(false);
  });

  it('accepts null quantity', () => {
    expect(RebalancePlanSchema.safeParse({
      ...validData,
      trades: [{ ...validData.trades[0], quantity: null }],
    }).success).toBe(true);
  });
});
