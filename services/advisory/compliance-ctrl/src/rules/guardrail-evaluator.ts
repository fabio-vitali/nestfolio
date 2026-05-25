import type { ComplianceInput, CheckResult } from './rule-engine';
import { resolveGuardrailParams } from './guardrail-params';

/**
 * Evaluates guardrail rules against the proposed trades.
 * Thresholds are derived at evaluation time from mandate.operatingMode
 * via resolveGuardrailParams — no numeric fields on MandateSnapshot.
 *
 * Checks:
 * - Max single trade size (% of portfolio) — skipped for initial portfolio construction
 * - Concentration limits (single position) — always runs
 * - Monthly turnover cap — skipped for initial portfolio construction
 *
 * The skip behaviour exists because BALANCED maxSingleTradePercent=10 and
 * monthlyTurnoverCapPercent=25 are calibrated for drift rebalances; an
 * initial allocation from cash necessarily exceeds them.
 */
export class GuardrailEvaluator {
  evaluate(input: ComplianceInput): CheckResult[] {
    return [
      this.checkSingleTradeSize(input),
      this.checkConcentrationLimit(input),
      this.checkTurnoverCap(input),
    ];
  }

  private checkSingleTradeSize(input: ComplianceInput): CheckResult {
    if (input.isInitialBuild) {
      return {
        name: 'MAX_SINGLE_TRADE',
        passed: true,
        details: 'Skipped for initial portfolio construction (no prior positions)',
      };
    }

    const { proposedTrades, portfolioValueCents, mandate } = input;
    const params = resolveGuardrailParams(mandate.operatingMode);
    const maxPercent = params.maxSingleTradePercent;
    const maxAmountCents = (portfolioValueCents * maxPercent) / 100;

    for (const trade of proposedTrades) {
      if (trade.quantityOrAmountCents > maxAmountCents) {
        const tradePercent =
          portfolioValueCents > 0
            ? (trade.quantityOrAmountCents / portfolioValueCents) * 100
            : 0;
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

    const positionWeights = new Map<string, number>();
    for (const pos of currentPositions) {
      positionWeights.set(pos.ticker, pos.weight);
    }

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
    if (input.isInitialBuild) {
      return {
        name: 'TURNOVER_CAP',
        passed: true,
        details: 'Skipped for initial portfolio construction (no prior positions)',
      };
    }

    const { proposedTrades, portfolioValueCents, mandate } = input;
    const params = resolveGuardrailParams(mandate.operatingMode);
    const maxTurnoverPercent = params.monthlyTurnoverCapPercent;
    const maxTurnoverCents = (portfolioValueCents * maxTurnoverPercent) / 100;

    const totalTurnoverCents = proposedTrades.reduce(
      (sum, trade) => sum + trade.quantityOrAmountCents,
      0,
    );

    if (totalTurnoverCents > maxTurnoverCents) {
      const turnoverPercent =
        portfolioValueCents > 0
          ? (totalTurnoverCents / portfolioValueCents) * 100
          : 0;
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
