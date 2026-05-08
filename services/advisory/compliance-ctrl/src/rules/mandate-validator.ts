import type { ComplianceInput, CheckResult } from './rule-engine';

/**
 * Validates that the mandate is active and the decision falls within mandate scope.
 * Checks:
 * - Mandate is not revoked (status field, set by MANDATE_REVOKED projection)
 * - Mandate effective date has passed (mandate is in effect)
 */
export class MandateValidator {
  validate(input: ComplianceInput): CheckResult {
    const { mandate } = input;

    // Status-driven REVOKED gate (set by MANDATE_REVOKED projection).
    // Single source of truth for mandate lifecycle — no legacy revokedAt fallback
    // since MandateSnapshot no longer carries that field.
    if (mandate.status === 'REVOKED') {
      return {
        name: 'MANDATE_REVOKED',
        passed: false,
        details: 'Mandate has been revoked; no further trades may be authorized',
      };
    }

    // Check if mandate effective date has passed
    const effectiveDate = new Date(mandate.effectiveDate);
    const now = new Date();
    if (effectiveDate > now) {
      return {
        name: 'MANDATE_ACTIVE',
        passed: false,
        details: `Mandate is not yet effective (effective date: ${mandate.effectiveDate})`,
      };
    }

    return {
      name: 'MANDATE_ACTIVE',
      passed: true,
      details: 'Mandate is active and in effect',
    };
  }
}
