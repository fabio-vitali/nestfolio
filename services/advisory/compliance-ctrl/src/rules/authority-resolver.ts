import type { ComplianceInput, Violation } from './rule-engine';

/**
 * Trade value threshold (in cents) above which L2 confirmation is required
 * even for DISCRETIONARY mandates.
 */
const LARGE_TRADE_THRESHOLD_CENTS = 50_000_00; // $50,000

/**
 * Determines the authority level for a compliance decision.
 * - L1 (autonomous): DISCRETIONARY mandate, all guardrails pass, trade value below threshold
 * - L2 (requires user confirmation): ADVISORY mandate, or large trades, or any violations
 */
export class AuthorityResolver {
  resolve(input: ComplianceInput, violations: Violation[]): 'L1' | 'L2' {
    const { mandate, proposedTrades } = input;

    // ADVISORY mandate always requires confirmation
    if (mandate.level === 'ADVISORY') {
      return 'L2';
    }

    // Any violations require L2 review
    if (violations.length > 0) {
      return 'L2';
    }

    // Check if any trade exceeds the large trade threshold
    const hasLargeTrade = proposedTrades.some(
      (trade) => trade.quantityOrAmountCents > LARGE_TRADE_THRESHOLD_CENTS,
    );

    if (hasLargeTrade) {
      return 'L2';
    }

    // DISCRETIONARY, no violations, no large trades -> autonomous
    return 'L1';
  }
}
