import { portfolioValidationRule, rebalanceValidationRule } from '../../../src/agents/validation';
import type { ValidationContext } from '@nestfolio/agent-orchestrator';

type Allocation = { instrument: string; assetClass: string; targetWeight: number; rationale: string };
type PortfolioOutput = {
  allocations: Allocation[];
  totalExposure: number;
  equityWeight: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number; largestPositionWeight: number };
  confidence: number;
};

const ctxFor = (mode: string, attempt = 0): ValidationContext => ({
  state: { operatingMode: mode },
  attempt,
});

const conservativeValid: PortfolioOutput = {
  allocations: [
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.50, rationale: 'Aggregate bonds' },
    { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.30, rationale: 'Short treasuries' },
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'US broad market' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'Ex-US broad market' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.20,
  riskMetrics: { concentrationRisk: 0.10, sectorDiversity: 0.85, largestPositionWeight: 0.10 },
  confidence: 0.88,
};

const balancedValid: PortfolioOutput = {
  allocations: [
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'US equity' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'Ex-US equity' },
    { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'Tech tilt' },
    { instrument: 'VWO', assetClass: 'EQUITY', targetWeight: 0.13, rationale: 'EM equity' },
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.27, rationale: 'Aggregate bonds' },
    { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.18, rationale: 'Short treasuries' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.55,
  riskMetrics: { concentrationRisk: 0.18, sectorDiversity: 0.72, largestPositionWeight: 0.14 },
  confidence: 0.86,
};

const aggressiveValid: PortfolioOutput = {
  allocations: [
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.20, rationale: 'US broad' },
    { instrument: 'VOO', assetClass: 'EQUITY', targetWeight: 0.18, rationale: 'S&P 500' },
    { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.15, rationale: 'Tech tilt' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.12, rationale: 'Ex-US broad' },
    { instrument: 'VWO', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'EM equity' },
    { instrument: 'ARKK', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'Innovation' },
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.10, rationale: 'Bond ballast' },
    { instrument: 'BIL', assetClass: 'CASH', targetWeight: 0.05, rationale: 'Cash sleeve' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.85,
  riskMetrics: { concentrationRisk: 0.22, sectorDiversity: 0.65, largestPositionWeight: 0.20 },
  confidence: 0.84,
};

describe('portfolioValidationRule — happy path per mode', () => {
  it('CONSERVATIVE: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.feedback).toBeUndefined();
  });

  it('BALANCED: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('BALANCED'));
    expect(r.valid).toBe(true);
  });

  it('AGGRESSIVE: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(aggressiveValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(true);
  });

  it('defaults to BALANCED envelope when ctx is omitted', () => {
    // balancedValid sits inside the BALANCED envelope; rule should accept
    // when no ctx is passed (and therefore no operatingMode) by defaulting.
    const r = portfolioValidationRule.validate(balancedValid);
    expect(r.valid).toBe(true);
  });
});

describe('portfolioValidationRule — mass conservation (mode-orthogonal)', () => {
  it('rejects when allocations sum drifts beyond 0.01 of totalExposure', () => {
    const drifted: PortfolioOutput = {
      ...balancedValid,
      allocations: [...balancedValid.allocations, { instrument: 'X', assetClass: 'CASH', targetWeight: 0.05, rationale: 'extra' }],
    };
    const r = portfolioValidationRule.validate(drifted, ctxFor('BALANCED'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('sum') || e.toLowerCase().includes('totalexposure'))).toBe(true);
    expect(r.feedback).toContain('totalExposure');
  });
});

describe('portfolioValidationRule — count band per mode', () => {
  it('CONSERVATIVE rejects 7 positions (must be in [3, 5])', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('allocations.length=6') || e.includes('allocations.length=7'))).toBe(true);
    expect(r.feedback).toContain('CONSOLIDATE');
  });

  it('AGGRESSIVE rejects 4 positions (must be in [6, 12])', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('allocations.length=4'))).toBe(true);
    expect(r.feedback).toContain('ADD');
  });
});

describe('portfolioValidationRule — equity weight band per mode', () => {
  it('CONSERVATIVE rejects equityWeight=0.55 (must be in [0, 0.30])', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('equityWeight=0.55'))).toBe(true);
    expect(r.feedback).toContain('REDUCE');
  });

  it('AGGRESSIVE rejects equityWeight=0.20 (must be in [0.70, 0.90])', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('equityWeight=0.20'))).toBe(true);
    expect(r.feedback).toContain('INCREASE');
  });
});

describe('portfolioValidationRule — largest EQUITY position cap per mode', () => {
  it('CONSERVATIVE rejects QQQ at 0.14 (cap=0.10) but PERMITS BND at 0.50', () => {
    const offender: PortfolioOutput = {
      ...conservativeValid,
      allocations: [
        { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.50, rationale: 'aggregate' },
        { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.20, rationale: 'short' },
        { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'tech tilt' },
        { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.16, rationale: 'ex-US' },
      ],
      totalExposure: 1.0,
      equityWeight: 0.30,
    };
    const r = portfolioValidationRule.validate(offender, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /largest EQUITY position .*=0\.16/.test(e) || /largest EQUITY position .*0\.14/.test(e) || /largest EQUITY position/.test(e))).toBe(true);
    // BND at 0.50 must NOT be flagged
    expect(r.errors.every((e) => !e.includes('BND'))).toBe(true);
    expect(r.feedback).toContain('CAP');
    expect(r.feedback).toContain('FIXED_INCOME');
  });
});

describe('portfolioValidationRule — feedback structure', () => {
  it('multi-violation feedback lists each violation on its own line and ends with re-emit instruction', () => {
    // Force a 3-violation output: count too high, equity too high, single equity position too large.
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain('You returned a portfolio that violates CONSERVATIVE mode rules');
    expect(r.feedback).toContain('Re-emit the structured-output tool');
    // feedback contains ≥ 2 line-prefixed violations
    expect((r.feedback ?? '').split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Rebalance plan validation — unchanged', () => {
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
