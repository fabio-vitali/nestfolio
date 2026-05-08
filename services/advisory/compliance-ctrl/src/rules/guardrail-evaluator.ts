import type { ComplianceInput, CheckResult } from './rule-engine';
import { resolveGuardrailParams } from './guardrail-params';

/**
 * Evaluates guardrail rules against the proposed trades.
 * Thresholds are derived at evaluation time from mandate.operatingMode
 * via resolveGuardrailParams — no numeric fields on MandateSnapshot.
 *
 * Checks:
 * - Max single trade size (% of portfolio)
 * - Monthly turnover cap
 * - Concentration limits (single stock)
 */
export class GuardrailEvaluator {
  evaluate(input: ComplianceInput): CheckResult[] {
    const results: CheckResult[] = [];

    results.push(this.checkSingleTradeSize(input));
    results.push(this.checkConcentrationLimit(input));
    results.push(this.checkTurnoverCap(input));

    return results;
  }

  private checkSingleTradeSize(input: ComplianceInput): CheckResult {
    const { proposedTrades, portfolioValue, mandate } = input;
    const params = resolveGuardrailParams(mandate.operatingMode);
    const maxPercent = params.maxSingleTradePercent;
    const maxAmountCents = (portfolioValue * maxPercent) / 100;

    for (const trade of proposedTrades) {
      if (trade.quantityOrAmountCents > maxAmountCents) {
        const tradePercent =
          (trade.quantityOrAmountCents / portfolioValue) * 100;
        return {
          name: 'MAX_SINGLE_TRADE',
          passed: false,
          details: `Trade ${trade.symbol} (${tradePercent.toFixed(1)}%) exceeds max single trade limit of ${maxPercent}%`,
        };
      }
    }

    return {
      name: 'MAX_SINGLE_TRADE',
      passed: true,
      details: 'All trades within single trade size limit',
    };
  }

  private checkConcentrationLimit(input: ComplianceInput): CheckResult {
    const { proposedTrades, currentPositions, mandate } = input;
    const params = resolveGuardrailParams(mandate.operatingMode);
    const maxConcentration = params.singleEtfConcentrationPercent;

    // Build a map of current weights
    const positionWeights = new Map<string, number>();
    for (const pos of currentPositions) {
      positionWeights.set(pos.ticker, pos.weight);
    }

    // Apply proposed trades to check resulting concentration
    for (const trade of proposedTrades) {
      const currentWeight = positionWeights.get(trade.symbol) ?? 0;
      const resultingWeight =
        trade.side === 'BUY'
          ? currentWeight + trade.targetWeightPercent
          : currentWeight - trade.targetWeightPercent;

      if (resultingWeight > maxConcentration) {
        return {
          name: 'CONCENTRATION_LIMIT',
          passed: false,
          details: `Position ${trade.symbol} would reach ${resultingWeight.toFixed(1)}%, exceeding concentration limit of ${maxConcentration}%`,
        };
      }
    }

    return {
      name: 'CONCENTRATION_LIMIT',
      passed: true,
      details: 'All positions within concentration limits',
    };
  }

  private checkTurnoverCap(input: ComplianceInput): CheckResult {
    const { proposedTrades, portfolioValue, mandate } = input;
    const params = resolveGuardrailParams(mandate.operatingMode);
    const maxTurnoverPercent = params.monthlyTurnoverCapPercent;
    const maxTurnoverCents = (portfolioValue * maxTurnoverPercent) / 100;

    const totalTurnoverCents = proposedTrades.reduce(
      (sum, trade) => sum + trade.quantityOrAmountCents,
      0,
    );

    if (totalTurnoverCents > maxTurnoverCents) {
      const turnoverPercent = (totalTurnoverCents / portfolioValue) * 100;
      return {
        name: 'TURNOVER_CAP',
        passed: false,
        details: `Total turnover ${turnoverPercent.toFixed(1)}% exceeds monthly cap of ${maxTurnoverPercent}%`,
      };
    }

    return {
      name: 'TURNOVER_CAP',
      passed: true,
      details: 'Total turnover within monthly cap',
    };
  }
}
