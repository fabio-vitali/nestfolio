import { AgentType } from './model-config';
import type { GoalInterpretation } from './output-schemas/user-goals.schema';
import type { RiskAssessment } from './output-schemas/risk-assessment.schema';
import type { MarketResearch } from './output-schemas/market-research.schema';
import type { PortfolioConstruction } from './output-schemas/portfolio-construction.schema';
import type { RebalancePlan } from './output-schemas/rebalance-planner.schema';
import type { Explanation } from './output-schemas/explainability.schema';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/**
 * Validates portfolio construction output beyond Zod schema checks.
 */
export function validatePortfolioConstruction(output: unknown): ValidationResult {
  const errors: string[] = [];
  const pc = output as PortfolioConstruction;

  const weightSum = pc.allocations.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    errors.push(`Weights sum to ${weightSum.toFixed(4)}, expected ~1.0 (tolerance 0.01)`);
  }

  for (const a of pc.allocations) {
    if (a.weight < 0) {
      errors.push(`Negative weight for ${a.ticker}: ${a.weight}`);
    }
    if (a.weight > 0.4) {
      errors.push(`Single position ${a.ticker} exceeds 40%: ${a.weight}`);
    }
  }

  if (pc.allocations.length < 2) {
    errors.push('At least 2 allocations required for diversification');
  }

  if (pc.expectedReturn < -0.5 || pc.expectedReturn > 1.0) {
    errors.push(`expectedReturn ${pc.expectedReturn} outside valid range [-0.5, 1.0]`);
  }

  if (pc.expectedVolatility < 0 || pc.expectedVolatility > 1.0) {
    errors.push(`expectedVolatility ${pc.expectedVolatility} outside valid range [0, 1.0]`);
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validates rebalance plan output beyond Zod schema checks.
 */
export function validateRebalancePlan(output: unknown): ValidationResult {
  const errors: string[] = [];
  const rp = output as RebalancePlan;

  const tickers = rp.trades.map((t) => t.ticker);
  const uniqueTickers = new Set(tickers);
  if (uniqueTickers.size !== tickers.length) {
    errors.push('Duplicate tickers found in trades');
  }

  for (const t of rp.trades) {
    if (t.quantity <= 0) {
      errors.push(`Trade quantity for ${t.ticker} must be > 0: ${t.quantity}`);
    }
  }

  if (rp.estimatedCost >= 500) {
    errors.push(`estimatedCost ${rp.estimatedCost} bps exceeds 500 bps sanity limit`);
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validates risk assessment output beyond Zod schema checks.
 */
export function validateRiskAssessment(output: unknown): ValidationResult {
  const errors: string[] = [];
  const ra = output as RiskAssessment;

  // Score-category consistency
  if (ra.riskScore < 20 && ra.riskCategory === 'aggressive') {
    errors.push(`riskScore ${ra.riskScore} is inconsistent with category 'aggressive'`);
  }
  if (ra.riskScore > 80 && ra.riskCategory === 'conservative') {
    errors.push(`riskScore ${ra.riskScore} is inconsistent with category 'conservative'`);
  }

  // maxDrawdown sanity relative to volatilityBudget
  if (ra.maxDrawdown < ra.volatilityBudget * 0.5) {
    errors.push(
      `maxDrawdown ${ra.maxDrawdown} seems too low relative to volatilityBudget ${ra.volatilityBudget} (expected >= volatilityBudget * 0.5)`,
    );
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validates goal interpretation output beyond Zod schema checks.
 */
export function validateGoalInterpretation(output: unknown): ValidationResult {
  const errors: string[] = [];
  const gi = output as GoalInterpretation;

  if (gi.timeHorizonMonths < 1 || gi.timeHorizonMonths > 600) {
    errors.push(`timeHorizonMonths ${gi.timeHorizonMonths} outside valid range [1, 600]`);
  }

  if (gi.targetReturn >= gi.riskBudget * 3) {
    errors.push(
      `targetReturn ${gi.targetReturn} exceeds riskBudget * 3 (${gi.riskBudget * 3}): efficiency frontier sanity check failed`,
    );
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validates market research output beyond Zod schema checks.
 */
export function validateMarketResearch(output: unknown): ValidationResult {
  const errors: string[] = [];
  const mr = output as MarketResearch;

  if (mr.signals.length < 1) {
    errors.push('At least 1 signal is required');
  }

  const tickers = mr.signals.map((s) => s.ticker);
  const uniqueTickers = new Set(tickers);
  if (uniqueTickers.size !== tickers.length) {
    errors.push('Duplicate tickers found in signals');
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Validates explanation output beyond Zod schema checks.
 */
export function validateExplanation(output: unknown): ValidationResult {
  const errors: string[] = [];
  const ex = output as Explanation;

  if (ex.summary.length <= 20) {
    errors.push(`summary length ${ex.summary.length} must be > 20 characters`);
  }

  if (ex.keyFactors.length < 1) {
    errors.push('At least 1 key factor is required');
  }

  if (ex.humanReadableRationale.length <= 20) {
    errors.push(
      `humanReadableRationale length ${ex.humanReadableRationale.length} must be > 20 characters`,
    );
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * Map of agent types to their validator functions.
 */
export const AGENT_VALIDATORS: Record<AgentType, (output: unknown) => ValidationResult> = {
  'user-goals': validateGoalInterpretation,
  'risk-assessment': validateRiskAssessment,
  'market-research': validateMarketResearch,
  'portfolio-construction': validatePortfolioConstruction,
  'rebalance-planner': validateRebalancePlan,
  explainability: validateExplanation,
};

/**
 * Dispatches validation to the correct validator based on agent type.
 */
export function validateAgentOutput(agentType: AgentType, output: unknown): ValidationResult {
  const validator = AGENT_VALIDATORS[agentType];
  if (!validator) {
    return { valid: false, errors: [`Unknown agent type: ${agentType as string}`] };
  }
  return validator(output);
}
