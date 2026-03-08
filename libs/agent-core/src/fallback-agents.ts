import { AgentType, AGENT_TYPES } from './model-config';
import { AgentNodeFn } from './agent-factory';
import { AgentNodeMap } from './graph-orchestrator';
import type { GoalInterpretation } from './output-schemas/user-goals.schema';
import type { RiskAssessment } from '@nestfolio/agent-core/output-schemas';
import type { MarketResearch } from '@nestfolio/agent-core/output-schemas';
import type { PortfolioConstruction } from '@nestfolio/agent-core/output-schemas';
import type { RebalancePlan } from '@nestfolio/agent-core/output-schemas';
import type { Explanation } from '@nestfolio/agent-core/output-schemas';

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
 * Creates a deterministic fallback node function for the given agent type.
 * The returned function ignores its input state and returns hardcoded,
 * schema-valid data under the agent type key.
 *
 * For 'portfolio-construction', accepts optional investor context and custom config
 * to select risk-profile-aware fallback allocations.
 */
export function createFallbackNode(
  type: AgentType,
  investorContext?: FallbackInvestorContext,
  customConfig?: FallbackAllocationConfig,
): AgentNodeFn {
  let data = FALLBACK_DATA[type];
  if (!data) {
    throw new Error(`Unknown agent type for fallback: ${type as string}`);
  }

  // For portfolio-construction, apply risk-profile-aware allocations
  if (type === 'portfolio-construction' && (investorContext || customConfig)) {
    const config = customConfig
      ?? RISK_PROFILE_ALLOCATIONS[investorContext?.riskProfile ?? 'balanced'];
    data = { ...config } satisfies PortfolioConstruction;
  }

  const frozenData = data;
  return async (_state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    return { [type]: frozenData };
  };
}

/**
 * Returns the fallback allocation config for a given risk profile.
 */
export function getFallbackAllocationConfig(
  riskProfile: FallbackInvestorContext['riskProfile'],
): FallbackAllocationConfig {
  return RISK_PROFILE_ALLOCATIONS[riskProfile];
}

/**
 * Creates a complete map of fallback node functions for all 6 agent types.
 * Accepts optional investor context for risk-profile-aware portfolio-construction fallback.
 */
export function createFallbackNodeMap(investorContext?: FallbackInvestorContext): AgentNodeMap {
  const map = {} as AgentNodeMap;
  for (const type of AGENT_TYPES) {
    map[type] = createFallbackNode(type, investorContext);
  }
  return map;
}
