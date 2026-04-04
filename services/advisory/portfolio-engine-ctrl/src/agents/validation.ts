import type { ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';

interface PortfolioOutput {
  allocations: Array<{ instrument: string; targetWeight: number; rationale: string }>;
  totalExposure: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number };
  confidence: number;
}

interface RebalanceOutput {
  trades: Array<{ action: string; instrument: string; targetWeight: number; currentWeight: number; quantity: number | null; rationale: string }>;
  estimatedTurnover: number;
  confidence: number;
}

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(errors: string[]): ValidationResult { return { valid: false, errors }; }

export const portfolioValidationRule: ValidationRule<PortfolioOutput> = {
  validate(output: PortfolioOutput): ValidationResult {
    const errors: string[] = [];
    const weightSum = output.allocations.reduce((sum, a) => sum + a.targetWeight, 0);

    if (output.allocations.length < 2) {
      errors.push('At least 2 allocations required for diversification');
    }

    if (Math.abs(weightSum - 1.0) > 0.01) {
      errors.push(`Weights sum to ${weightSum.toFixed(4)}, expected ~1.0`);
    }

    for (const a of output.allocations) {
      if (a.targetWeight > 0.5) {
        errors.push(`Single position ${a.instrument} exceeds 50%: ${a.targetWeight}`);
      }
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};

export const rebalanceValidationRule: ValidationRule<RebalanceOutput> = {
  validate(output: RebalanceOutput): ValidationResult {
    const errors: string[] = [];
    const instruments = output.trades.map((t) => t.instrument);
    const unique = new Set(instruments);

    if (unique.size !== instruments.length) {
      errors.push('Duplicate instruments found in trades');
    }

    if (output.estimatedTurnover > 1.0) {
      errors.push(`estimatedTurnover ${output.estimatedTurnover} exceeds 100% — excessive turnover`);
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
