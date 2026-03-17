import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
} from '../../src/agents/schemas';

describe('Advisory Agent Schemas', () => {
  describe('GoalInterpretationSchema', () => {
    const validData = {
      goalId: 'goal-001',
      interpretedObjective: 'Long-term growth for retirement',
      timeHorizonMonths: 240,
      targetReturn: 0.08,
      riskBudget: 0.15,
      constraints: ['no-tobacco', 'ESG-only'],
      confidence: 0.85,
    };

    it('accepts valid data', () => {
      expect(GoalInterpretationSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects missing goalId', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { goalId: _, ...invalid } = validData;
      expect(GoalInterpretationSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects targetReturn > 1', () => {
      expect(GoalInterpretationSchema.safeParse({ ...validData, targetReturn: 1.5 }).success).toBe(false);
    });

    it('rejects negative timeHorizonMonths', () => {
      expect(GoalInterpretationSchema.safeParse({ ...validData, timeHorizonMonths: -12 }).success).toBe(false);
    });

    it('rejects confidence > 1', () => {
      expect(GoalInterpretationSchema.safeParse({ ...validData, confidence: 1.5 }).success).toBe(false);
    });

    it('accepts boundary confidence = 0', () => {
      expect(GoalInterpretationSchema.safeParse({ ...validData, confidence: 0 }).success).toBe(true);
    });

    it('accepts boundary confidence = 1', () => {
      expect(GoalInterpretationSchema.safeParse({ ...validData, confidence: 1 }).success).toBe(true);
    });
  });

  describe('RiskAssessmentSchema', () => {
    const validData = {
      riskScore: 45,
      riskCategory: 'balanced' as const,
      maxDrawdown: 0.2,
      volatilityBudget: 0.12,
      concentrationLimits: { equity: 0.6, bonds: 0.4 },
      rationale: 'Moderate risk tolerance based on stated goals',
    };

    it('accepts valid data', () => {
      expect(RiskAssessmentSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects riskScore > 100', () => {
      expect(RiskAssessmentSchema.safeParse({ ...validData, riskScore: 150 }).success).toBe(false);
    });

    it('rejects riskScore < 0', () => {
      expect(RiskAssessmentSchema.safeParse({ ...validData, riskScore: -1 }).success).toBe(false);
    });

    it('accepts boundary riskScore = 0', () => {
      expect(RiskAssessmentSchema.safeParse({ ...validData, riskScore: 0 }).success).toBe(true);
    });

    it('accepts boundary riskScore = 100', () => {
      expect(RiskAssessmentSchema.safeParse({ ...validData, riskScore: 100 }).success).toBe(true);
    });

    it('rejects invalid riskCategory', () => {
      expect(RiskAssessmentSchema.safeParse({ ...validData, riskCategory: 'ultra-risky' }).success).toBe(false);
    });
  });

  describe('MarketResearchSchema', () => {
    const validData = {
      signals: [
        { ticker: 'AAPL', signal: 'buy' as const, strength: 0.7, rationale: 'Strong earnings' },
      ],
      marketRegime: 'risk-on' as const,
      sectorRotation: { technology: 0.5, energy: -0.3 },
    };

    it('accepts valid data', () => {
      expect(MarketResearchSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects invalid signal value', () => {
      expect(MarketResearchSchema.safeParse({
        ...validData,
        signals: [{ ticker: 'AAPL', signal: 'maybe', strength: 0.5, rationale: 'Test' }],
      }).success).toBe(false);
    });

    it('rejects strength > 1', () => {
      expect(MarketResearchSchema.safeParse({
        ...validData,
        signals: [{ ticker: 'AAPL', signal: 'buy', strength: 1.5, rationale: 'Test' }],
      }).success).toBe(false);
    });
  });

  describe('PortfolioConstructionSchema', () => {
    const validData = {
      allocations: [
        { ticker: 'VTI', weight: 0.6, rationale: 'Broad equity exposure' },
        { ticker: 'BND', weight: 0.4, rationale: 'Fixed income ballast' },
      ],
      expectedReturn: 0.07,
      expectedVolatility: 0.1,
      sharpeRatio: 0.7,
    };

    it('accepts valid data', () => {
      expect(PortfolioConstructionSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects empty allocations', () => {
      expect(PortfolioConstructionSchema.safeParse({ ...validData, allocations: [] }).success).toBe(false);
    });

    it('rejects weight > 1', () => {
      expect(PortfolioConstructionSchema.safeParse({
        ...validData,
        allocations: [{ ticker: 'VTI', weight: 1.5, rationale: 'Too much' }],
      }).success).toBe(false);
    });

    it('accepts boundary weight = 0', () => {
      expect(PortfolioConstructionSchema.safeParse({
        ...validData,
        allocations: [
          { ticker: 'VTI', weight: 0, rationale: 'Zero' },
          { ticker: 'BND', weight: 1, rationale: 'All' },
        ],
      }).success).toBe(true);
    });
  });

  describe('RebalancePlanSchema', () => {
    const validData = {
      trades: [
        { ticker: 'VTI', action: 'buy' as const, quantity: 10, urgency: 'next-session' as const },
      ],
      estimatedCost: 5,
      rebalanceReason: 'Drift from target allocation',
    };

    it('accepts valid data', () => {
      expect(RebalancePlanSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects invalid action', () => {
      expect(RebalancePlanSchema.safeParse({
        ...validData,
        trades: [{ ticker: 'VTI', action: 'swap', quantity: 10, urgency: 'next-session' }],
      }).success).toBe(false);
    });

    it('rejects negative quantity', () => {
      expect(RebalancePlanSchema.safeParse({
        ...validData,
        trades: [{ ticker: 'VTI', action: 'buy', quantity: -5, urgency: 'next-session' }],
      }).success).toBe(false);
    });
  });

  describe('ExplanationSchema', () => {
    const validData = {
      summary: 'A balanced portfolio focused on long-term growth.',
      keyFactors: ['Low interest rates', 'Strong equity fundamentals'],
      riskWarnings: ['Market volatility may increase'],
      confidence: 0.8,
      humanReadableRationale: 'We recommend a mix of stocks and bonds.',
    };

    it('accepts valid data', () => {
      expect(ExplanationSchema.safeParse(validData).success).toBe(true);
    });

    it('rejects empty keyFactors', () => {
      expect(ExplanationSchema.safeParse({ ...validData, keyFactors: [] }).success).toBe(false);
    });

    it('rejects confidence > 1', () => {
      expect(ExplanationSchema.safeParse({ ...validData, confidence: 1.5 }).success).toBe(false);
    });
  });
});
