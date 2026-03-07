import type { ComplianceInput, CheckResult } from './rule-engine';

/**
 * Maps risk scores (1-10) to maximum equity allocation percentages.
 * Lower risk score = lower equity tolerance.
 */
const RISK_SCORE_TO_MAX_EQUITY: Record<number, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
  9: 90,
  10: 100,
};

/**
 * Checks suitability of proposed trades against the investor's risk profile.
 * Ensures the total equity exposure after trades stays within acceptable bounds
 * for the investor's risk score.
 */
export class SuitabilityChecker {
  check(input: ComplianceInput): CheckResult {
    const { riskScore, proposedTrades, currentPositions } = input;

    const maxEquityPercent = RISK_SCORE_TO_MAX_EQUITY[riskScore] ?? 50;

    // Calculate current equity weight from positions
    const currentEquityWeight = currentPositions.reduce(
      (sum, pos) => sum + pos.weight,
      0,
    );

    // Calculate net equity change from proposed trades (only equity asset class)
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
        details: `Resulting equity exposure ${resultingEquity.toFixed(1)}% exceeds max ${maxEquityPercent}% for risk score ${riskScore}`,
      };
    }

    return {
      name: 'SUITABILITY',
      passed: true,
      details: `Equity exposure ${resultingEquity.toFixed(1)}% is within acceptable range for risk score ${riskScore}`,
    };
  }
}
