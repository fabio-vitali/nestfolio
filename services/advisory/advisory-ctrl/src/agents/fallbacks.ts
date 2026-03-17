import type { GoalInterpretation } from './schemas';
import type { RiskAssessment } from './schemas';
import type { MarketResearch } from './schemas';
import type { PortfolioConstruction } from './schemas';
import type { RebalancePlan } from './schemas';
import type { Explanation } from './schemas';
import type { AgentType } from './config';

/** Investor context for risk-profile-aware fallback selection. */
export interface FallbackInvestorContext {
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  mandateLevel?: 'ADVISORY' | 'DISCRETIONARY';
}

/** Fallback allocation configuration. */
export interface FallbackAllocationConfig {
  allocations: Array<{ ticker: string; weight: number; rationale: string }>;
  expectedReturn: number;
  expectedVolatility: number;
  sharpeRatio: number;
}

const RISK_PROFILE_ALLOCATIONS: Record<FallbackInvestorContext['riskProfile'], FallbackAllocationConfig> = {
  conservative: {
    allocations: [
      { ticker: 'VTI', weight: 0.3, rationale: 'US equity core (conservative fallback)' },
      { ticker: 'BND', weight: 0.5, rationale: 'Fixed income majority (conservative fallback)' },
      { ticker: 'VTIP', weight: 0.2, rationale: 'Inflation-protected bonds (conservative fallback)' },
    ],
    expectedReturn: 0.045,
    expectedVolatility: 0.06,
    sharpeRatio: 0.5,
  },
  balanced: {
    allocations: [
      { ticker: 'VTI', weight: 0.6, rationale: 'US equity core (fallback)' },
      { ticker: 'BND', weight: 0.4, rationale: 'Fixed income ballast (fallback)' },
    ],
    expectedReturn: 0.065,
    expectedVolatility: 0.1,
    sharpeRatio: 0.65,
  },
  aggressive: {
    allocations: [
      { ticker: 'VTI', weight: 0.8, rationale: 'US equity core (aggressive fallback)' },
      { ticker: 'BND', weight: 0.1, rationale: 'Minimal fixed income (aggressive fallback)' },
      { ticker: 'QQQ', weight: 0.1, rationale: 'Growth tilt (aggressive fallback)' },
    ],
    expectedReturn: 0.09,
    expectedVolatility: 0.16,
    sharpeRatio: 0.56,
  },
};

const FALLBACK_DATA: Record<AgentType, unknown> = {
  'user-goals': {
    goalId: 'fallback-goal',
    interpretedObjective: 'Long-term balanced growth',
    timeHorizonMonths: 120,
    targetReturn: 0.07,
    riskBudget: 0.12,
    constraints: ['Diversified portfolio required'],
    confidence: 0.5,
  } satisfies GoalInterpretation,

  'risk-assessment': {
    riskScore: 50,
    riskCategory: 'moderate',
    maxDrawdown: 0.15,
    volatilityBudget: 0.12,
    concentrationLimits: { singleStock: 0.1, sector: 0.3 },
    rationale: 'Deterministic fallback: moderate risk profile applied',
  } satisfies RiskAssessment,

  'market-research': {
    signals: [
      {
        ticker: 'VTI',
        signal: 'hold',
        strength: 0.5,
        rationale: 'Neutral market assessment (fallback)',
      },
    ],
    marketRegime: 'transitional',
    sectorRotation: {},
  } satisfies MarketResearch,

  'portfolio-construction': {
    allocations: [
      { ticker: 'VTI', weight: 0.6, rationale: 'US equity core (fallback)' },
      { ticker: 'BND', weight: 0.4, rationale: 'Fixed income ballast (fallback)' },
    ],
    expectedReturn: 0.065,
    expectedVolatility: 0.1,
    sharpeRatio: 0.65,
  } satisfies PortfolioConstruction,

  'rebalance-planner': {
    trades: [],
    estimatedCost: 0,
    rebalanceReason: 'No rebalance recommended (deterministic fallback)',
  } satisfies RebalancePlan,

  explainability: {
    summary:
      'A balanced portfolio allocation has been recommended based on your moderate risk profile.',
    keyFactors: ['Risk profile: moderate', 'Market conditions: neutral', 'Time horizon: long-term'],
    riskWarnings: [
      'Past performance does not guarantee future results',
      'This recommendation used a deterministic fallback due to AI service unavailability',
    ],
    confidence: 0.4,
    humanReadableRationale:
      'Based on standard portfolio theory, a diversified allocation across equities and fixed income has been applied.',
  } satisfies Explanation,
};

/**
 * Returns the fallback allocation config for a given risk profile.
 */
export function getFallbackAllocationConfig(
  riskProfile: FallbackInvestorContext['riskProfile'],
): FallbackAllocationConfig {
  return RISK_PROFILE_ALLOCATIONS[riskProfile];
}

/**
 * Fallback map for all 6 advisory agent types.
 * Each function takes the full state and returns a deterministic, schema-valid output.
 *
 * For 'portfolio-construction', the fallback uses the balanced allocation by default.
 * Use `createFallbackMap` with investor context for risk-profile-aware fallbacks.
 */
export const FALLBACK_MAP: Record<AgentType, (input: Record<string, unknown>) => Record<string, unknown>> = {
  'user-goals': () => ({ ...FALLBACK_DATA['user-goals'] as Record<string, unknown> }),
  'risk-assessment': () => ({ ...FALLBACK_DATA['risk-assessment'] as Record<string, unknown> }),
  'market-research': () => ({ ...FALLBACK_DATA['market-research'] as Record<string, unknown> }),
  'portfolio-construction': () => ({ ...FALLBACK_DATA['portfolio-construction'] as Record<string, unknown> }),
  'rebalance-planner': () => ({ ...FALLBACK_DATA['rebalance-planner'] as Record<string, unknown> }),
  explainability: () => ({ ...FALLBACK_DATA['explainability'] as Record<string, unknown> }),
};

/**
 * Creates a fallback map with optional risk-profile-aware portfolio-construction.
 */
export function createFallbackMap(
  investorContext?: FallbackInvestorContext,
): Record<AgentType, (input: Record<string, unknown>) => Record<string, unknown>> {
  if (!investorContext) return FALLBACK_MAP;

  const profileConfig = RISK_PROFILE_ALLOCATIONS[investorContext.riskProfile];
  return {
    ...FALLBACK_MAP,
    'portfolio-construction': () => ({ ...profileConfig }),
  };
}
