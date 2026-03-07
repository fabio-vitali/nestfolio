import { AgentType, AGENT_TYPES } from './model-config';
import { AgentNodeFn } from './agent-factory';
import { AgentNodeMap } from './graph-orchestrator';
import type { GoalInterpretation } from './output-schemas/user-goals.schema';
import type { RiskAssessment } from '@nestfolio/agent-core/output-schemas';
import type { MarketResearch } from '@nestfolio/agent-core/output-schemas';
import type { PortfolioConstruction } from '@nestfolio/agent-core/output-schemas';
import type { RebalancePlan } from '@nestfolio/agent-core/output-schemas';
import type { Explanation } from '@nestfolio/agent-core/output-schemas';

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
 */
export function createFallbackNode(type: AgentType): AgentNodeFn {
  const data = FALLBACK_DATA[type];
  if (!data) {
    throw new Error(`Unknown agent type for fallback: ${type as string}`);
  }
  return async (_state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    return { [type]: data };
  };
}

/**
 * Creates a complete map of fallback node functions for all 6 agent types.
 */
export function createFallbackNodeMap(): AgentNodeMap {
  const map = {} as AgentNodeMap;
  for (const type of AGENT_TYPES) {
    map[type] = createFallbackNode(type);
  }
  return map;
}
