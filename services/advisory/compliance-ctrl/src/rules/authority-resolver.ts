import type { ComplianceInput, Violation } from './rule-engine';
import { resolveGuardrailParams } from './guardrail-params';

/**
 * Determines the authority level for a compliance decision.
 * Derives numeric thresholds from the mandate's operatingMode via resolveGuardrailParams
 * so no guardrail numbers live on MandateSnapshot itself.
 * - L1 (autonomous): DISCRETIONARY mandate, all guardrails pass, within thresholds
 * - L2 (requires user confirmation): ADVISORY mandate, violations, or threshold exceeded
 */
export class AuthorityResolver {
  resolve(input: ComplianceInput, violations: Violation[]): 'L1' | 'L2' {
    const { mandate, proposedTrades, portfolioValue } = input;

    // Revoked mandate forces user-confirmation gate; mandate-validator emits
    // a BLOCKING violation so the final result will be BLOCKED regardless.
    if (mandate.status === 'REVOKED') {
      return 'L2';
    }

    // ADVISORY mandate always requires confirmation
    if (mandate.level === 'ADVISORY') {
      return 'L2';
    }

    // Any violations require L2 review
    if (violations.length > 0) {
      return 'L2';
    }

    const guardrails = resolveGuardrailParams(mandate.operatingMode);

    // Check each trade against mode-derived maxSingleTradePercent
    const maxTradeAmountCents = (portfolioValue * guardrails.maxSingleTradePercent) / 100;
    const hasOversizedTrade = proposedTrades.some(
      (trade) => trade.quantityOrAmountCents > maxTradeAmountCents,
    );
    if (hasOversizedTrade) {
      return 'L2';
    }

    // Check total turnover against mode-derived monthlyTurnoverCapPercent
    const maxTurnoverCents = (portfolioValue * guardrails.monthlyTurnoverCapPercent) / 100;
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
