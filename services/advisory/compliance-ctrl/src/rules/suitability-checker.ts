import type { ComplianceInput, CheckResult, RiskCategory } from './rule-engine';

/**
 * Maps risk category to maximum equity allocation percentage.
 * Aligned with investor-bff/src/domain/risk-profile.service.ts band ranges:
 * CONSERVATIVE → maxEquity=0.30, MODERATE → 0.60, AGGRESSIVE → 0.90.
 */
const CATEGORY_TO_MAX_EQUITY: Record<RiskCategory, number> = {
  CONSERVATIVE: 30,
  MODERATE: 60,
  AGGRESSIVE: 90,
};

/**
 * Checks suitability of proposed trades against the investor's risk category.
 * Ensures the total equity exposure after trades stays within acceptable bounds.
 */
export class SuitabilityChecker {
  check(input: ComplianceInput): CheckResult {
    const { riskCategory, proposedTrades, currentPositions } = input;

    const maxEquityPercent = CATEGORY_TO_MAX_EQUITY[riskCategory] ?? 60;

    const currentEquityWeight = currentPositions.reduce(
      (sum, pos) => sum + pos.weight,
      0,
    );

    const equityChange = proposedTrades
      .filter((t) => t.assetClass === 'EQUITY')
      .reduce((sum, trade) => {
        const delta = trade.targetWeightPercent;
        return trade.side === 'BUY' ? sum + delta : sum - delta;
      }, 0);

    const resultingEquity = currentEquityWeight + equityChange;

    if (resultingEquity > maxEquityPercent) {
      return {
        name: 'SUITABILITY',
        passed: false,
        details: `Resulting equity exposure ${resultingEquity.toFixed(1)}% exceeds max ${maxEquityPercent}% for risk category ${riskCategory}`,
      };
    }

    return {
      name: 'SUITABILITY',
      passed: true,
      details: `Equity exposure ${resultingEquity.toFixed(1)}% is within acceptable range for risk category ${riskCategory}`,
    };
  }
}
