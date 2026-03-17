import { VALIDATION_RULES, getValidationConfig, isValidTicker } from '../../src/agents/validation';
import { AGENT_TYPES } from '../../src/agents/config';

describe('Advisory Agent Validation', () => {
  describe('VALIDATION_RULES coverage', () => {
    it('has a validator for every agent type', () => {
      for (const type of AGENT_TYPES) {
        expect(VALIDATION_RULES[type]).toBeDefined();
        expect(typeof VALIDATION_RULES[type].validate).toBe('function');
      }
    });
  });

  describe('user-goals validation', () => {
    const validate = VALIDATION_RULES['user-goals'].validate;
    const validGoal = {
      goalId: 'g1',
      interpretedObjective: 'Growth',
      timeHorizonMonths: 120,
      targetReturn: 0.08,
      riskBudget: 0.15,
      constraints: [],
      confidence: 0.8,
    };

    it('passes valid goal', () => {
      expect(validate(validGoal).valid).toBe(true);
    });

    it('fails when timeHorizonMonths is 0', () => {
      const r = validate({ ...validGoal, timeHorizonMonths: 0 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('timeHorizonMonths');
    });

    it('fails when timeHorizonMonths exceeds 600', () => {
      const r = validate({ ...validGoal, timeHorizonMonths: 601 });
      expect(r.valid).toBe(false);
    });

    it('fails when targetReturn exceeds riskBudget * 3', () => {
      const r = validate({ ...validGoal, targetReturn: 0.5, riskBudget: 0.1 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('efficiency frontier');
    });

    it('passes when targetReturn is just below riskBudget * 3', () => {
      expect(validate({ ...validGoal, targetReturn: 0.29, riskBudget: 0.1 }).valid).toBe(true);
    });
  });

  describe('risk-assessment validation', () => {
    const validate = VALIDATION_RULES['risk-assessment'].validate;
    const validRisk = {
      riskScore: 50,
      riskCategory: 'moderate',
      maxDrawdown: 0.15,
      volatilityBudget: 0.12,
      concentrationLimits: { singleStock: 0.1 },
      rationale: 'Moderate risk',
    };

    it('passes valid risk assessment', () => {
      expect(validate(validRisk).valid).toBe(true);
    });

    it('fails when low score with aggressive category', () => {
      const r = validate({ ...validRisk, riskScore: 10, riskCategory: 'aggressive' });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('inconsistent');
    });

    it('fails when high score with conservative category', () => {
      const r = validate({ ...validRisk, riskScore: 90, riskCategory: 'conservative' });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('inconsistent');
    });

    it('fails when maxDrawdown is too low relative to volatilityBudget', () => {
      const r = validate({ ...validRisk, maxDrawdown: 0.02, volatilityBudget: 0.15 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('maxDrawdown');
    });
  });

  describe('market-research validation', () => {
    const validate = VALIDATION_RULES['market-research'].validate;
    const validMarket = {
      signals: [{ ticker: 'VTI', signal: 'buy', strength: 0.7, rationale: 'Core' }],
      marketRegime: 'risk-on',
      sectorRotation: {},
    };

    it('passes valid market research', () => {
      expect(validate(validMarket).valid).toBe(true);
    });

    it('fails with empty signals', () => {
      const r = validate({ ...validMarket, signals: [] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('1 signal');
    });

    it('fails with duplicate tickers in signals', () => {
      const r = validate({
        ...validMarket,
        signals: [
          { ticker: 'VTI', signal: 'buy', strength: 0.7, rationale: 'Core' },
          { ticker: 'VTI', signal: 'sell', strength: 0.3, rationale: 'Other' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Duplicate tickers');
    });
  });

  describe('portfolio-construction validation', () => {
    const validate = VALIDATION_RULES['portfolio-construction'].validate;
    const validPortfolio = {
      allocations: [
        { ticker: 'VTI', weight: 0.35, rationale: 'Core' },
        { ticker: 'BND', weight: 0.35, rationale: 'Ballast' },
        { ticker: 'VXUS', weight: 0.30, rationale: 'International' },
      ],
      expectedReturn: 0.07,
      expectedVolatility: 0.1,
      sharpeRatio: 0.7,
    };

    it('passes valid portfolio', () => {
      expect(validate(validPortfolio).valid).toBe(true);
    });

    it('fails when weights do not sum to ~1.0', () => {
      const r = validate({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.3, rationale: 'Core' },
          { ticker: 'BND', weight: 0.3, rationale: 'Ballast' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Weights sum to');
    });

    it('fails with negative weights', () => {
      const r = validate({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: -0.1, rationale: 'Short' },
          { ticker: 'BND', weight: 0.4, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.4, rationale: 'Intl' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: string) => e.includes('Negative weight'))).toBe(true);
    });

    it('fails when single position exceeds 40% (default balanced)', () => {
      const r = validate({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.20, rationale: 'Core' },
          { ticker: 'BND', weight: 0.30, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.50, rationale: 'Too big' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: string) => e.includes('exceeds 40%'))).toBe(true);
    });

    it('fails with fewer than minimum allocations (default: 3)', () => {
      const r = validate({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.5, rationale: 'Core' },
          { ticker: 'BND', weight: 0.5, rationale: 'Ballast' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: string) => e.includes('3 allocations'))).toBe(true);
    });

    it('fails with invalid ticker format', () => {
      const r = validate({
        allocations: [
          { ticker: 'VTI', weight: 0.35, rationale: 'Core' },
          { ticker: 'invalid_ticker', weight: 0.35, rationale: 'Bad' },
          { ticker: 'BND', weight: 0.30, rationale: 'Bonds' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: string) => e.includes('Invalid ticker format'))).toBe(true);
    });

    it('passes at exactly 0.005 weight tolerance deviation', () => {
      const r = validate({
        allocations: [
          { ticker: 'VTI', weight: 0.335, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.33, rationale: 'International' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      // 0.335 + 0.33 + 0.33 = 0.995, deviation = 0.005, NOT > 0.005
      expect(r.valid).toBe(true);
    });

    it('fails at 0.006 weight tolerance deviation', () => {
      const r = validate({
        allocations: [
          { ticker: 'VTI', weight: 0.334, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.33, rationale: 'International' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      // 0.334 + 0.33 + 0.33 = 0.994, deviation = 0.006 > 0.005
      expect(r.valid).toBe(false);
    });
  });

  describe('rebalance-planner validation', () => {
    const validate = VALIDATION_RULES['rebalance-planner'].validate;
    const validPlan = {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 10, urgency: 'next-session' },
        { ticker: 'BND', action: 'sell', quantity: 5, urgency: 'next-session' },
      ],
      estimatedCost: 5,
      rebalanceReason: 'Rebalance',
    };

    it('passes valid plan', () => {
      expect(validate(validPlan).valid).toBe(true);
    });

    it('passes empty trade list', () => {
      expect(validate({ trades: [], estimatedCost: 0, rebalanceReason: 'No rebalance needed' }).valid).toBe(true);
    });

    it('fails with duplicate tickers', () => {
      const r = validate({
        ...validPlan,
        trades: [
          { ticker: 'VTI', action: 'buy', quantity: 10, urgency: 'next-session' },
          { ticker: 'VTI', action: 'sell', quantity: 5, urgency: 'next-session' },
        ],
      });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('Duplicate tickers');
    });

    it('fails with zero quantity', () => {
      const r = validate({
        ...validPlan,
        trades: [{ ticker: 'VTI', action: 'buy', quantity: 0, urgency: 'next-session' }],
      });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('quantity');
    });

    it('fails with estimatedCost >= 500 bps', () => {
      const r = validate({ ...validPlan, estimatedCost: 500 });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('500 bps');
    });
  });

  describe('explainability validation', () => {
    const validate = VALIDATION_RULES['explainability'].validate;
    const validExplanation = {
      summary: 'A balanced portfolio with diversified holdings across asset classes.',
      keyFactors: ['Risk: moderate', 'Horizon: long-term'],
      riskWarnings: [],
      confidence: 0.8,
      humanReadableRationale: 'Your portfolio is designed for steady long-term growth.',
    };

    it('passes valid explanation', () => {
      expect(validate(validExplanation).valid).toBe(true);
    });

    it('fails with short summary', () => {
      const r = validate({ ...validExplanation, summary: 'Too short' });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('summary length');
    });

    it('fails with no key factors', () => {
      const r = validate({ ...validExplanation, keyFactors: [] });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('key factor');
    });

    it('fails with short humanReadableRationale', () => {
      const r = validate({ ...validExplanation, humanReadableRationale: 'Short' });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: string) => e.includes('humanReadableRationale'))).toBe(true);
    });
  });

  describe('risk-profile-aware validation config', () => {
    it('conservative profile: max single position 30%, min 4 allocations', () => {
      const config = getValidationConfig('conservative');
      expect(config.maxSinglePositionWeight).toBe(0.3);
      expect(config.minAllocations).toBe(4);
    });

    it('aggressive profile: max single position 50%, min 2 allocations', () => {
      const config = getValidationConfig('aggressive');
      expect(config.maxSinglePositionWeight).toBe(0.5);
      expect(config.minAllocations).toBe(2);
    });

    it('defaults to balanced when no profile given', () => {
      const config = getValidationConfig();
      expect(config.maxSinglePositionWeight).toBe(0.4);
      expect(config.minAllocations).toBe(3);
    });
  });

  describe('isValidTicker', () => {
    it('accepts valid US tickers', () => {
      expect(isValidTicker('VTI')).toBe(true);
      expect(isValidTicker('AAPL')).toBe(true);
      expect(isValidTicker('A')).toBe(true);
    });

    it('accepts valid ISINs', () => {
      expect(isValidTicker('US0378331005')).toBe(true);
      expect(isValidTicker('GB00B03MLX29')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidTicker('vti')).toBe(false);
      expect(isValidTicker('TOOLONG')).toBe(false);
      expect(isValidTicker('123')).toBe(false);
      expect(isValidTicker('')).toBe(false);
      expect(isValidTicker('VTI.US')).toBe(false);
    });
  });
});
