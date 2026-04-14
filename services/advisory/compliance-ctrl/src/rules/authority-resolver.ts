import type { ComplianceInput, Violation } from './rule-engine';

/**
 * Determines the authority level for a compliance decision.
 * Uses mode-derived thresholds from the mandate snapshot instead of hardcoded values.
 * - L1 (autonomous): DISCRETIONARY mandate, all guardrails pass, within thresholds
 * - L2 (requires user confirmation): ADVISORY mandate, violations, or threshold exceeded
 */
export class AuthorityResolver {
  resolve(input: ComplianceInput, violations: Violation[]): 'L1' | 'L2' {
    const { mandate, proposedTrades, portfolioValue } = input;

    // ADVISORY mandate always requires confirmation
    if (mandate.level === 'ADVISORY') {
      return 'L2';
    }

    // Any violations require L2 review
    if (violations.length > 0) {
      return 'L2';
    }

    // Check each trade against mode-derived maxSingleTradePercent
    const maxTradeAmountCents = (portfolioValue * mandate.maxSingleTradePercent) / 100;
    const hasOversizedTrade = proposedTrades.some(
      (trade) => trade.quantityOrAmountCents > maxTradeAmountCents,
    );
    if (hasOversizedTrade) {
      return 'L2';
    }

    // Check total turnover against mode-derived monthlyTurnoverCapPercent
    const maxTurnoverCents = (portfolioValue * mandate.monthlyTurnoverCapPercent) / 100;
    const totalTurnoverCents = proposedTrades.reduce(
      (sum, trade) => sum + trade.quantityOrAmountCents, 0,
    );
    if (totalTurnoverCents > maxTurnoverCents) {
      return 'L2';
    }

    // DISCRETIONARY, no violations, all thresholds pass -> autonomous
    return 'L1';
  }
}
