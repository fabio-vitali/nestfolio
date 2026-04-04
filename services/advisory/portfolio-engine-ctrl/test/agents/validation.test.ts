import { portfolioValidationRule, rebalanceValidationRule } from '../../src/agents/validation';

describe('Portfolio construction validation', () => {
  const validOutput = {
    allocations: [
      { instrument: 'VTI', targetWeight: 0.4, rationale: 'Core' },
      { instrument: 'BND', targetWeight: 0.3, rationale: 'Bonds' },
      { instrument: 'VXUS', targetWeight: 0.3, rationale: 'International' },
    ],
    totalExposure: 1.0,
    riskMetrics: { concentrationRisk: 0.25, sectorDiversity: 0.75 },
    confidence: 0.85,
  };

  it('passes valid output', () => {
    expect(portfolioValidationRule.validate(validOutput).valid).toBe(true);
  });

  it('fails when weights do not sum to ~1.0', () => {
    const r = portfolioValidationRule.validate({
      ...validOutput,
      allocations: [
        { instrument: 'VTI', targetWeight: 0.3, rationale: 'Core' },
        { instrument: 'BND', targetWeight: 0.3, rationale: 'Bonds' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('sum');
  });

  it('fails when single position exceeds 50%', () => {
    const r = portfolioValidationRule.validate({
      ...validOutput,
      allocations: [
        { instrument: 'VTI', targetWeight: 0.55, rationale: 'Core' },
        { instrument: 'BND', targetWeight: 0.25, rationale: 'Bonds' },
        { instrument: 'VXUS', targetWeight: 0.20, rationale: 'Intl' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('50%');
  });

  it('fails with fewer than 2 allocations', () => {
    const r = portfolioValidationRule.validate({
      ...validOutput,
      allocations: [{ instrument: 'VTI', targetWeight: 1.0, rationale: 'All-in' }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('2 allocations');
  });
});

describe('Rebalance plan validation', () => {
  const validPlan = {
    trades: [
      { action: 'BUY', instrument: 'VTI', targetWeight: 0.6, currentWeight: 0.5, quantity: 10, rationale: 'Increase' },
    ],
    estimatedTurnover: 0.1,
    confidence: 0.8,
  };

  it('passes valid plan', () => {
    expect(rebalanceValidationRule.validate(validPlan).valid).toBe(true);
  });

  it('fails with duplicate instruments', () => {
    const r = rebalanceValidationRule.validate({
      ...validPlan,
      trades: [
        { action: 'BUY', instrument: 'VTI', targetWeight: 0.6, currentWeight: 0.5, quantity: 10, rationale: 'A' },
        { action: 'SELL', instrument: 'VTI', targetWeight: 0.4, currentWeight: 0.5, quantity: 5, rationale: 'B' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('Duplicate');
  });

  it('fails when estimatedTurnover exceeds 1.0', () => {
    const r = rebalanceValidationRule.validate({ ...validPlan, estimatedTurnover: 1.5 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('turnover');
  });
});
