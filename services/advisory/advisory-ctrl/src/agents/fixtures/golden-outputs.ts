import type {
  GoalInterpretation,
  RiskAssessment,
  MarketResearch,
  PortfolioConstruction,
  RebalancePlan,
  Explanation,
} from '../schemas';

// Valid golden outputs for the MODERATE_INVESTOR_CONTEXT
export const MODERATE_USER_GOALS: GoalInterpretation = {
  goalId: 'golden-goal-1',
  interpretedObjective: 'Long-term balanced growth through diversified investment',
  timeHorizonMonths: 120,
  targetReturn: 0.07,
  riskBudget: 0.12,
  constraints: ['Diversified portfolio', 'No excessive concentration'],
  confidence: 0.85,
};

export const MODERATE_RISK: RiskAssessment = {
  riskScore: 50,
  riskCategory: 'moderate',
  maxDrawdown: 0.15,
  volatilityBudget: 0.12,
  concentrationLimits: { singleStock: 0.15, sector: 0.35 },
  rationale: 'Moderate risk profile with balanced growth objective',
};

export const MODERATE_MARKET: MarketResearch = {
  signals: [
    { ticker: 'VTI', signal: 'buy', strength: 0.65, rationale: 'US equity market growth' },
    { ticker: 'VXUS', signal: 'hold', strength: 0.5, rationale: 'International diversification' },
    { ticker: 'BND', signal: 'hold', strength: 0.55, rationale: 'Fixed income stability' },
  ],
  marketRegime: 'risk-on',
  sectorRotation: { technology: 0.3, healthcare: 0.1, financials: -0.1 },
};

export const MODERATE_PORTFOLIO: PortfolioConstruction = {
  allocations: [
    { ticker: 'VTI', weight: 0.4, rationale: 'US equity core holding' },
    { ticker: 'VXUS', weight: 0.15, rationale: 'International equity diversification' },
    { ticker: 'BND', weight: 0.3, rationale: 'Fixed income ballast' },
    { ticker: 'VNQ', weight: 0.15, rationale: 'Real estate diversification' },
  ],
  expectedReturn: 0.07,
  expectedVolatility: 0.1,
  sharpeRatio: 0.7,
};

export const MODERATE_REBALANCE: RebalancePlan = {
  trades: [
    { ticker: 'VTI', action: 'buy', quantity: 20, urgency: 'next-session' },
    { ticker: 'VXUS', action: 'buy', quantity: 8, urgency: 'next-session' },
    { ticker: 'BND', action: 'buy', quantity: 15, urgency: 'within-week' },
    { ticker: 'VNQ', action: 'buy', quantity: 5, urgency: 'within-week' },
  ],
  estimatedCost: 3.5,
  rebalanceReason: 'Initial portfolio construction for moderate investor',
};

export const MODERATE_EXPLANATION: Explanation = {
  summary:
    'Based on your moderate risk profile and 10-year investment horizon, we recommend a diversified portfolio with approximately 60% equities and 40% bonds and alternatives.',
  keyFactors: [
    'Risk tolerance: moderate (score 5/10)',
    'Time horizon: 10 years',
    'Market conditions: favorable for equities',
    'Goal: long-term balanced growth',
  ],
  riskWarnings: [
    'Past performance does not guarantee future results',
    'Equity allocation involves market risk',
  ],
  confidence: 0.82,
  humanReadableRationale:
    'Your portfolio balances growth potential from equities with stability from bonds. The 60/40 split is designed for your moderate risk tolerance and 10-year timeline.',
};
