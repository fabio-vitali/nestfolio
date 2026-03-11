import {
  validatePortfolioConstruction,
  validateRebalancePlan,
  validateRiskAssessment,
  validateGoalInterpretation,
  validateMarketResearch,
  validateExplanation,
  validateAgentOutput,
  AGENT_VALIDATORS,
  getValidationConfig,
  isValidTicker,
} from '../src/output-validation';
import { AGENT_TYPES } from '../src/model-config';

describe('output-validation', () => {
  describe('validatePortfolioConstruction', () => {
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
      const result = validatePortfolioConstruction(validPortfolio);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when weights do not sum to ~1.0', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.3, rationale: 'Core' },
          { ticker: 'BND', weight: 0.3, rationale: 'Ballast' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Weights sum to');
    });

    it('passes when weights sum to ~0.995 (within tolerance)', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.335, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.33, rationale: 'International' },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('fails when weights sum to 0.98 (outside tolerance)', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.33, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.32, rationale: 'International' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Weights sum to');
    });

    it('fails with negative weights', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: -0.1, rationale: 'Short' },
          { ticker: 'BND', weight: 0.4, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.4, rationale: 'Intl' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Negative weight'))).toBe(true);
    });

    it('fails when single position exceeds 40% (default balanced)', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.20, rationale: 'Core' },
          { ticker: 'BND', weight: 0.30, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.50, rationale: 'Too big' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds 40%'))).toBe(true);
    });

    it('fails with fewer than minimum allocations (default: 3)', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        allocations: [
          { ticker: 'VTI', weight: 0.5, rationale: 'Core' },
          { ticker: 'BND', weight: 0.5, rationale: 'Ballast' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('3 allocations'))).toBe(true);
    });

    it('fails with expectedReturn out of range', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        expectedReturn: 1.5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('expectedReturn'))).toBe(true);
    });

    it('fails with expectedVolatility out of range', () => {
      const result = validatePortfolioConstruction({
        ...validPortfolio,
        expectedVolatility: -0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('expectedVolatility'))).toBe(true);
    });
  });

  describe('validateRebalancePlan', () => {
    const validPlan = {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 10, urgency: 'next-session' },
        { ticker: 'BND', action: 'sell', quantity: 5, urgency: 'next-session' },
      ],
      estimatedCost: 5,
      rebalanceReason: 'Rebalance',
    };

    it('passes valid plan', () => {
      const result = validateRebalancePlan(validPlan);
      expect(result.valid).toBe(true);
    });

    it('passes empty trade list', () => {
      const result = validateRebalancePlan({
        trades: [],
        estimatedCost: 0,
        rebalanceReason: 'No rebalance needed',
      });
      expect(result.valid).toBe(true);
    });

    it('fails with duplicate tickers', () => {
      const result = validateRebalancePlan({
        ...validPlan,
        trades: [
          { ticker: 'VTI', action: 'buy', quantity: 10, urgency: 'next-session' },
          { ticker: 'VTI', action: 'sell', quantity: 5, urgency: 'next-session' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Duplicate tickers');
    });

    it('fails with zero quantity', () => {
      const result = validateRebalancePlan({
        ...validPlan,
        trades: [{ ticker: 'VTI', action: 'buy', quantity: 0, urgency: 'next-session' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('quantity');
    });

    it('fails with estimatedCost >= 500 bps', () => {
      const result = validateRebalancePlan({
        ...validPlan,
        estimatedCost: 500,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('500 bps');
    });
  });

  describe('validateRiskAssessment', () => {
    const validRisk = {
      riskScore: 50,
      riskCategory: 'moderate' as const,
      maxDrawdown: 0.15,
      volatilityBudget: 0.12,
      concentrationLimits: { singleStock: 0.1 },
      rationale: 'Moderate risk',
    };

    it('passes valid risk assessment', () => {
      const result = validateRiskAssessment(validRisk);
      expect(result.valid).toBe(true);
    });

    it('fails when low score with aggressive category', () => {
      const result = validateRiskAssessment({
        ...validRisk,
        riskScore: 10,
        riskCategory: 'aggressive',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('inconsistent');
    });

    it('fails when high score with conservative category', () => {
      const result = validateRiskAssessment({
        ...validRisk,
        riskScore: 90,
        riskCategory: 'conservative',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('inconsistent');
    });

    it('fails when maxDrawdown is too low relative to volatilityBudget', () => {
      const result = validateRiskAssessment({
        ...validRisk,
        maxDrawdown: 0.02,
        volatilityBudget: 0.15,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('maxDrawdown');
    });
  });

  describe('validateGoalInterpretation', () => {
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
      const result = validateGoalInterpretation(validGoal);
      expect(result.valid).toBe(true);
    });

    it('fails when timeHorizonMonths is 0', () => {
      const result = validateGoalInterpretation({
        ...validGoal,
        timeHorizonMonths: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('timeHorizonMonths');
    });

    it('fails when timeHorizonMonths exceeds 600', () => {
      const result = validateGoalInterpretation({
        ...validGoal,
        timeHorizonMonths: 601,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('timeHorizonMonths');
    });

    it('fails when targetReturn exceeds riskBudget * 3', () => {
      const result = validateGoalInterpretation({
        ...validGoal,
        targetReturn: 0.5,
        riskBudget: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('efficiency frontier');
    });

    it('passes when targetReturn is just below riskBudget * 3', () => {
      const result = validateGoalInterpretation({
        ...validGoal,
        targetReturn: 0.29,
        riskBudget: 0.1,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateMarketResearch', () => {
    const validMarket = {
      signals: [{ ticker: 'VTI', signal: 'buy', strength: 0.7, rationale: 'Core' }],
      marketRegime: 'risk-on',
      sectorRotation: {},
    };

    it('passes valid market research', () => {
      const result = validateMarketResearch(validMarket);
      expect(result.valid).toBe(true);
    });

    it('fails with empty signals', () => {
      const result = validateMarketResearch({
        ...validMarket,
        signals: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('1 signal');
    });

    it('fails with duplicate tickers in signals', () => {
      const result = validateMarketResearch({
        ...validMarket,
        signals: [
          { ticker: 'VTI', signal: 'buy', strength: 0.7, rationale: 'Core' },
          { ticker: 'VTI', signal: 'sell', strength: 0.3, rationale: 'Other' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Duplicate tickers');
    });
  });

  describe('validateExplanation', () => {
    const validExplanation = {
      summary: 'A balanced portfolio with diversified holdings across asset classes.',
      keyFactors: ['Risk: moderate', 'Horizon: long-term'],
      riskWarnings: [],
      confidence: 0.8,
      humanReadableRationale: 'Your portfolio is designed for steady long-term growth.',
    };

    it('passes valid explanation', () => {
      const result = validateExplanation(validExplanation);
      expect(result.valid).toBe(true);
    });

    it('fails with short summary', () => {
      const result = validateExplanation({
        ...validExplanation,
        summary: 'Too short',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('summary length');
    });

    it('fails with no key factors', () => {
      const result = validateExplanation({
        ...validExplanation,
        keyFactors: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('key factor');
    });

    it('fails with short humanReadableRationale', () => {
      const result = validateExplanation({
        ...validExplanation,
        humanReadableRationale: 'Short',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('humanReadableRationale'))).toBe(true);
    });
  });

  describe('validateAgentOutput', () => {
    it('dispatches to the correct validator for each agent type', () => {
      for (const type of AGENT_TYPES) {
        expect(AGENT_VALIDATORS[type]).toBeDefined();
      }
    });

    it('dispatches portfolio-construction correctly', () => {
      const result = validateAgentOutput('portfolio-construction', {
        allocations: [
          { ticker: 'VTI', weight: 0.35, rationale: 'Core' },
          { ticker: 'BND', weight: 0.35, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.30, rationale: 'International' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      expect(result.valid).toBe(true);
    });

    it('dispatches risk-assessment correctly and reports errors', () => {
      const result = validateAgentOutput('risk-assessment', {
        riskScore: 10,
        riskCategory: 'aggressive',
        maxDrawdown: 0.15,
        volatilityBudget: 0.12,
        concentrationLimits: {},
        rationale: 'Test',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('inconsistent');
    });
  });

  describe('risk-profile-aware validation', () => {
    const basePortfolio = {
      expectedReturn: 0.07,
      expectedVolatility: 0.1,
      sharpeRatio: 0.7,
    };

    it('conservative profile: rejects single position > 30%', () => {
      const config = getValidationConfig('conservative');
      const result = validatePortfolioConstruction(
        {
          ...basePortfolio,
          allocations: [
            { ticker: 'VTI', weight: 0.35, rationale: 'Core' },
            { ticker: 'BND', weight: 0.25, rationale: 'Bonds' },
            { ticker: 'VXUS', weight: 0.20, rationale: 'Intl' },
            { ticker: 'VTIP', weight: 0.20, rationale: 'TIPS' },
          ],
        },
        config,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds 30%'))).toBe(true);
    });

    it('aggressive profile: allows single position up to 50%', () => {
      const config = getValidationConfig('aggressive');
      const result = validatePortfolioConstruction(
        {
          ...basePortfolio,
          allocations: [
            { ticker: 'VTI', weight: 0.50, rationale: 'Core' },
            { ticker: 'BND', weight: 0.50, rationale: 'Bonds' },
          ],
        },
        config,
      );
      expect(result.valid).toBe(true);
    });

    it('conservative profile: requires at least 4 allocations', () => {
      const config = getValidationConfig('conservative');
      const result = validatePortfolioConstruction(
        {
          ...basePortfolio,
          allocations: [
            { ticker: 'VTI', weight: 0.30, rationale: 'Core' },
            { ticker: 'BND', weight: 0.30, rationale: 'Bonds' },
            { ticker: 'VXUS', weight: 0.40, rationale: 'Intl' },
          ],
        },
        config,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('4 allocations'))).toBe(true);
    });
  });

  describe('isValidTicker', () => {
    it('accepts valid US tickers', () => {
      expect(isValidTicker('VTI')).toBe(true);
      expect(isValidTicker('AAPL')).toBe(true);
      expect(isValidTicker('A')).toBe(true);
      expect(isValidTicker('VXUS')).toBe(true);
    });

    it('accepts valid ISINs', () => {
      expect(isValidTicker('US0378331005')).toBe(true);
      expect(isValidTicker('GB00B03MLX29')).toBe(true);
    });

    it('rejects invalid ticker formats', () => {
      expect(isValidTicker('vti')).toBe(false);
      expect(isValidTicker('TOOLONG')).toBe(false);
      expect(isValidTicker('123')).toBe(false);
      expect(isValidTicker('')).toBe(false);
      expect(isValidTicker('VTI.US')).toBe(false);
    });
  });

  describe('ticker validation in portfolio', () => {
    it('fails when portfolio contains invalid ticker', () => {
      const result = validatePortfolioConstruction({
        allocations: [
          { ticker: 'VTI', weight: 0.35, rationale: 'Core' },
          { ticker: 'invalid_ticker', weight: 0.35, rationale: 'Bad' },
          { ticker: 'BND', weight: 0.30, rationale: 'Bonds' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid ticker format'))).toBe(true);
    });
  });

  describe('weight tolerance boundary (0.005)', () => {
    it('passes at exactly 0.005 deviation', () => {
      const result = validatePortfolioConstruction({
        allocations: [
          { ticker: 'VTI', weight: 0.335, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.33, rationale: 'International' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      // 0.335 + 0.33 + 0.33 = 0.995, deviation = 0.005, NOT > 0.005 → passes
      expect(result.valid).toBe(true);
    });

    it('fails at 0.006 deviation', () => {
      const result = validatePortfolioConstruction({
        allocations: [
          { ticker: 'VTI', weight: 0.334, rationale: 'Core' },
          { ticker: 'BND', weight: 0.33, rationale: 'Ballast' },
          { ticker: 'VXUS', weight: 0.33, rationale: 'International' },
        ],
        expectedReturn: 0.07,
        expectedVolatility: 0.1,
        sharpeRatio: 0.7,
      });
      // 0.334 + 0.33 + 0.33 = 0.994, deviation = 0.006 > 0.005 → fails
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Weights sum to');
    });
  });
});
