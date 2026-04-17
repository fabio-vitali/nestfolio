import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
} from '../../../src/agents/schemas';
import { VALIDATION_RULES } from '../../../src/agents/validation';
import {
  MODERATE_USER_GOALS,
  MODERATE_RISK,
  MODERATE_MARKET,
  MODERATE_PORTFOLIO,
  MODERATE_REBALANCE,
  MODERATE_EXPLANATION,
} from '../../../src/agents/fixtures/golden-outputs';

describe('Golden fixtures: schema compliance', () => {
  it.each([
    ['user-goals', GoalInterpretationSchema, MODERATE_USER_GOALS],
    ['risk-assessment', RiskAssessmentSchema, MODERATE_RISK],
    ['market-research', MarketResearchSchema, MODERATE_MARKET],
    ['portfolio-construction', PortfolioConstructionSchema, MODERATE_PORTFOLIO],
    ['rebalance-planner', RebalancePlanSchema, MODERATE_REBALANCE],
    ['explainability', ExplanationSchema, MODERATE_EXPLANATION],
  ] as const)('%s golden output passes Zod schema', (_, schema, fixture) => {
    const result = (schema as { safeParse: (v: unknown) => { success: boolean; error?: unknown } }).safeParse(fixture);
    if (!result.success) {
      console.error('Schema validation errors:', result.error);
    }
    expect(result.success).toBe(true);
  });
});

describe('Golden fixtures: business validation', () => {
  it('user-goals golden output passes validation', () => {
    expect(VALIDATION_RULES['user-goals'].validate(MODERATE_USER_GOALS).valid).toBe(true);
  });

  it('risk-assessment golden output passes validation', () => {
    expect(VALIDATION_RULES['risk-assessment'].validate(MODERATE_RISK).valid).toBe(true);
  });

  it('market-research golden output passes validation', () => {
    expect(VALIDATION_RULES['market-research'].validate(MODERATE_MARKET).valid).toBe(true);
  });

  it('portfolio-construction golden output passes validation', () => {
    expect(VALIDATION_RULES['portfolio-construction'].validate(MODERATE_PORTFOLIO).valid).toBe(true);
  });

  it('rebalance-planner golden output passes validation', () => {
    expect(VALIDATION_RULES['rebalance-planner'].validate(MODERATE_REBALANCE).valid).toBe(true);
  });

  it('explainability golden output passes validation', () => {
    expect(VALIDATION_RULES['explainability'].validate(MODERATE_EXPLANATION).valid).toBe(true);
  });
});
