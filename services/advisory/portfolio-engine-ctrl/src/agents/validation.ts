import type { ValidationContext, ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';
import type { OperatingMode } from './prompts';

interface Allocation {
  instrument: string;
  assetClass: string;
  targetWeight: number;
  rationale: string;
}

interface PortfolioOutput {
  allocations: Allocation[];
  totalExposure: number;
  equityWeight: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number; largestPositionWeight: number };
  confidence: number;
}

interface RebalanceOutput {
  trades: Array<{ action: string; instrument: string; targetWeight: number; currentWeight: number; quantity: number | null; rationale: string }>;
  estimatedTurnover: number;
  confidence: number;
}

interface ModeEnvelope {
  readonly equityRange: readonly [number, number];
  readonly largestEquityCap: number;
  readonly countRange: readonly [number, number];
}

interface Violation {
  readonly kind: 'mass' | 'count' | 'equity' | 'largestEquity';
  readonly observed: number | string;
  readonly expected: string;
}

const MODE_ENVELOPE: Record<OperatingMode, ModeEnvelope> = {
  CONSERVATIVE: { equityRange: [0, 0.30], largestEquityCap: 0.10, countRange: [3, 5] },
  BALANCED:     { equityRange: [0.50, 0.70], largestEquityCap: 0.15, countRange: [5, 8] },
  AGGRESSIVE:   { equityRange: [0.70, 0.90], largestEquityCap: 0.25, countRange: [6, 12] },
};

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(errors: string[], feedback: string): ValidationResult { return { valid: false, errors, feedback }; }

function resolveMode(ctx?: ValidationContext): OperatingMode {
  const raw = ctx?.state['operatingMode'];
  if (raw === 'CONSERVATIVE' || raw === 'AGGRESSIVE') return raw;
  return 'BALANCED';
}

function formatCorrectiveFeedback(
  mode: OperatingMode,
  env: ModeEnvelope,
  violations: Violation[],
  output: PortfolioOutput,
): string {
  const lines: string[] = [`You returned a portfolio that violates ${mode} mode rules. Specifically:`];
  for (const v of violations) {
    if (v.kind === 'mass') {
      lines.push(`- targetWeights sum to ${v.observed} but totalExposure is ${output.totalExposure}. Re-balance so the two match within 0.01.`);
    } else if (v.kind === 'count') {
      const [lo, hi] = env.countRange;
      const current = output.allocations.length;
      lines.push(current < lo
        ? `- allocations.length=${current} — must be in [${lo}, ${hi}]. ADD ${lo - current} more positions.`
        : `- allocations.length=${current} — must be in [${lo}, ${hi}]. CONSOLIDATE ${current - hi} positions into broader ETFs (e.g. one VTI instead of VTI+VOO+QQQ).`);
    } else if (v.kind === 'equity') {
      const [lo, hi] = env.equityRange;
      const eq = Number(v.observed);
      lines.push(eq > hi
        ? `- equityWeight=${eq.toFixed(2)} — must be in [${lo}, ${hi}]. REDUCE equity sleeve by ~${(eq - hi).toFixed(2)} by trimming individual EQUITY targetWeights or reallocating to FIXED_INCOME / CASH.`
        : `- equityWeight=${eq.toFixed(2)} — must be in [${lo}, ${hi}]. INCREASE equity sleeve by ~${(lo - eq).toFixed(2)} by adding EQUITY positions or raising existing EQUITY targetWeights.`);
    } else if (v.kind === 'largestEquity') {
      lines.push(`- largest EQUITY position is ${v.observed} — must be ≤ ${env.largestEquityCap}. CAP individual EQUITY positions at ${env.largestEquityCap} each (FIXED_INCOME / CASH positions are exempt from this cap).`);
    }
  }
  lines.push(`Re-emit the structured-output tool with corrected allocations.`);
  return lines.join('\n');
}

export const portfolioValidationRule: ValidationRule<PortfolioOutput> = {
  validate(output: PortfolioOutput, ctx?: ValidationContext): ValidationResult {
    const mode = resolveMode(ctx);
    const env = MODE_ENVELOPE[mode];
    const errors: string[] = [];
    const violations: Violation[] = [];

    // 1. Mass conservation (mode-orthogonal)
    const weightSum = output.allocations.reduce((s, a) => s + a.targetWeight, 0);
    if (Math.abs(weightSum - output.totalExposure) > 0.01) {
      errors.push(`Weights sum to ${weightSum.toFixed(4)}, totalExposure=${output.totalExposure}`);
      violations.push({ kind: 'mass', observed: weightSum.toFixed(4), expected: `≈${output.totalExposure}` });
    }

    // 2. Count band
    const count = output.allocations.length;
    const [countMin, countMax] = env.countRange;
    if (count < countMin || count > countMax) {
      errors.push(`allocations.length=${count}, must be in [${countMin}, ${countMax}] for ${mode}`);
      violations.push({ kind: 'count', observed: count, expected: `[${countMin}, ${countMax}]` });
    }

    // 3. Equity weight band (computed from allocations, not the model-reported field)
    const equityPositions = output.allocations.filter((a) => a.assetClass === 'EQUITY');
    const equitySum = equityPositions.reduce((s, a) => s + a.targetWeight, 0);
    const [eqMin, eqMax] = env.equityRange;
    if (equitySum < eqMin || equitySum > eqMax) {
      errors.push(`equityWeight=${equitySum.toFixed(2)}, must be in [${eqMin}, ${eqMax}] for ${mode}`);
      violations.push({ kind: 'equity', observed: equitySum, expected: `[${eqMin}, ${eqMax}]` });
    }

    // 4. Largest EQUITY position cap
    const largestEquity = equityPositions.length > 0
      ? Math.max(...equityPositions.map((a) => a.targetWeight))
      : 0;
    if (largestEquity > env.largestEquityCap) {
      const offender = equityPositions.find((a) => a.targetWeight === largestEquity)?.instrument ?? '?';
      errors.push(`largest EQUITY position ${offender}=${largestEquity.toFixed(2)}, must be ≤ ${env.largestEquityCap} for ${mode}`);
      violations.push({ kind: 'largestEquity', observed: `${offender}=${largestEquity.toFixed(2)}`, expected: `≤ ${env.largestEquityCap}` });
    }

    if (errors.length === 0) return ok();
    return fail(errors, formatCorrectiveFeedback(mode, env, violations, output));
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

    return errors.length > 0 ? { valid: false, errors } : { valid: true, errors: [] };
  },
};
