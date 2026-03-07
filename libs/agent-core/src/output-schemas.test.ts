import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
  getOutputSchema,
} from './output-schemas';
import { AGENT_TYPES, AgentType } from './model-config';

describe('Output Schemas', () => {
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
      const result = GoalInterpretationSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects missing goalId', () => {
      const { goalId: _, ...invalid } = validData;
      const result = GoalInterpretationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects targetReturn > 1', () => {
      const result = GoalInterpretationSchema.safeParse({
        ...validData,
        targetReturn: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative timeHorizonMonths', () => {
      const result = GoalInterpretationSchema.safeParse({
        ...validData,
        timeHorizonMonths: -12,
      });
      expect(result.success).toBe(false);
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
      const result = RiskAssessmentSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects riskScore > 100', () => {
      const result = RiskAssessmentSchema.safeParse({
        ...validData,
        riskScore: 150,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid riskCategory', () => {
      const result = RiskAssessmentSchema.safeParse({
        ...validData,
        riskCategory: 'ultra-risky',
      });
      expect(result.success).toBe(false);
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
      const result = MarketResearchSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects invalid signal value', () => {
      const result = MarketResearchSchema.safeParse({
        ...validData,
        signals: [
          { ticker: 'AAPL', signal: 'maybe', strength: 0.5, rationale: 'Test' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects strength > 1', () => {
      const result = MarketResearchSchema.safeParse({
        ...validData,
        signals: [
          { ticker: 'AAPL', signal: 'buy', strength: 1.5, rationale: 'Test' },
        ],
      });
      expect(result.success).toBe(false);
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
      const result = PortfolioConstructionSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects empty allocations', () => {
      const result = PortfolioConstructionSchema.safeParse({
        ...validData,
        allocations: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects weight > 1', () => {
      const result = PortfolioConstructionSchema.safeParse({
        ...validData,
        allocations: [
          { ticker: 'VTI', weight: 1.5, rationale: 'Too much' },
        ],
      });
      expect(result.success).toBe(false);
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
      const result = RebalancePlanSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects invalid action', () => {
      const result = RebalancePlanSchema.safeParse({
        ...validData,
        trades: [
          { ticker: 'VTI', action: 'swap', quantity: 10, urgency: 'next-session' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative quantity', () => {
      const result = RebalancePlanSchema.safeParse({
        ...validData,
        trades: [
          { ticker: 'VTI', action: 'buy', quantity: -5, urgency: 'next-session' },
        ],
      });
      expect(result.success).toBe(false);
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
      const result = ExplanationSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('rejects empty keyFactors', () => {
      const result = ExplanationSchema.safeParse({
        ...validData,
        keyFactors: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects confidence > 1', () => {
      const result = ExplanationSchema.safeParse({
        ...validData,
        confidence: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('getOutputSchema', () => {
    it.each(AGENT_TYPES)('returns a schema for agent type "%s"', (agentType) => {
      const schema = getOutputSchema(agentType);
      expect(schema).toBeDefined();
      expect(typeof schema.safeParse).toBe('function');
    });

    it('throws for an unknown agent type', () => {
      expect(() => getOutputSchema('unknown' as AgentType)).toThrow(
        'Unknown agent type: unknown',
      );
    });
  });
});
