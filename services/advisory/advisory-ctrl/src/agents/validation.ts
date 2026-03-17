import type { ValidationRule, ValidationResult } from '@nestfolio/agent-core';
import type { GoalInterpretation } from './schemas';
import type { RiskAssessment } from './schemas';
import type { MarketResearch } from './schemas';
import type { PortfolioConstruction } from './schemas';
import type { RebalancePlan } from './schemas';
import type { Explanation } from './schemas';
import type { AgentType } from './config';

/** Risk profile category for validation limit adjustments. */
export type ValidationRiskProfile = 'conservative' | 'balanced' | 'aggressive';

/** Configuration for portfolio construction validation, adjustable per risk profile. */
export interface ValidationConfig {
  /** Maximum weight for a single position (default: 0.4 = 40%) */
  maxSinglePositionWeight: number;
  /** Minimum number of allocations required (default: 3) */
  minAllocations: number;
  /** Weight sum tolerance (default: 0.005) */
  weightTolerance: number;
}

const RISK_PROFILE_LIMITS: Record<ValidationRiskProfile, ValidationConfig> = {
  conservative: { maxSinglePositionWeight: 0.3, minAllocations: 4, weightTolerance: 0.005 },
  balanced:     { maxSinglePositionWeight: 0.4, minAllocations: 3, weightTolerance: 0.005 },
  aggressive:   { maxSinglePositionWeight: 0.5, minAllocations: 2, weightTolerance: 0.005 },
};

/** Returns validation config for a given risk profile, or default (balanced) if not provided. */
export function getValidationConfig(riskProfile?: ValidationRiskProfile): ValidationConfig {
  return RISK_PROFILE_LIMITS[riskProfile ?? 'balanced'];
}

/** Validates a ticker format: US ticker (1-5 uppercase letters) or ISIN (2 letters + 10 alphanumeric). */
export function isValidTicker(ticker: string): boolean {
  return /^[A-Z]{1,5}$/.test(ticker) || /^[A-Z]{2}[A-Z0-9]{10}$/.test(ticker);
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/**
 * Validates portfolio construction output beyond Zod schema checks.
 * Accepts an optional config to adjust limits per risk profile.
 */
function validatePortfolioConstruction(output: unknown, config?: ValidationConfig): ValidationResult {
  const errors: string[] = [];
  const pc = output as PortfolioConstruction;
  const cfg = config ?? getValidationConfig();

  const weightSum = pc.allocations.reduce((sum, a) => sum + a.weight, 0);
  if (Math.abs(weightSum - 1.0) > cfg.weightTolerance) {
    errors.push(`Weights sum to ${weightSum.toFixed(4)}, expected ~1.0 (tolerance ${cfg.weightTolerance})`);
  }

  for (const a of pc.allocations) {
    if (a.weight < 0) {
      errors.push(`Negative weight for ${a.ticker}: ${a.weight}`);
    }
    if (a.weight > cfg.maxSinglePositionWeight) {
      errors.push(
        `Single position ${a.ticker} exceeds ${(cfg.maxSinglePositionWeight * 100).toFixed(0)}%: ${a.weight}`,
      );
    }
    if (!isValidTicker(a.ticker)) {
      errors.push(`Invalid ticker format: '${a.ticker}' (expected 1-5 uppercase letters or ISIN)`);
    }
  }

  if (pc.allocations.length < cfg.minAllocations) {
    errors.push(`At least ${cfg.minAllocations} allocations required for diversification`);
  }

  if (pc.expectedReturn < -0.5 || pc.expectedReturn > 1.0) {
    errors.push(`expectedReturn ${pc.expectedReturn} outside valid range [-0.5, 1.0]`);
  }

  if (pc.expectedVolatility < 0 || pc.expectedVolatility > 1.0) {
    errors.push(`expectedVolatility ${pc.expectedVolatility} outside valid range [0, 1.0]`);
  }

  return errors.length > 0 ? fail(errors) : ok();
}

/** Validates rebalance plan output beyond Zod schema checks. */
function validateRebalancePlan(output: unknown): ValidationResult {
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

/** Validates risk assessment output beyond Zod schema checks. */
function validateRiskAssessment(output: unknown): ValidationResult {
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

/** Validates goal interpretation output beyond Zod schema checks. */
function validateGoalInterpretation(output: unknown): ValidationResult {
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

/** Validates market research output beyond Zod schema checks. */
function validateMarketResearch(output: unknown): ValidationResult {
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

/** Validates explanation output beyond Zod schema checks. */
function validateExplanation(output: unknown): ValidationResult {
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
 * Validation rules for all 6 advisory agent types.
 * Each rule wraps the domain-specific validator into the generic ValidationRule interface.
 */
export const VALIDATION_RULES: Record<AgentType, ValidationRule<any>> = {
  'user-goals': { validate: validateGoalInterpretation },
  'risk-assessment': { validate: validateRiskAssessment },
  'market-research': { validate: validateMarketResearch },
  'portfolio-construction': { validate: validatePortfolioConstruction },
  'rebalance-planner': { validate: validateRebalancePlan },
  explainability: { validate: validateExplanation },
};
