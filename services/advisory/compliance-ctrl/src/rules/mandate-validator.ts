import type { ComplianceInput, CheckResult } from './rule-engine';

/**
 * Validates that the mandate is active and the decision falls within mandate scope.
 * Checks:
 * - Mandate is not revoked
 * - Mandate effective date has passed (mandate is in effect)
 */
export class MandateValidator {
  validate(input: ComplianceInput): CheckResult {
    const { mandate } = input;

    // Check if mandate has been revoked
    if (mandate.revokedAt !== null) {
      return {
        name: 'MANDATE_ACTIVE',
        passed: false,
        details: `Mandate ${mandate.mandateId} was revoked at ${mandate.revokedAt}`,
      };
    }

    // Check if mandate effective date has passed
    const effectiveDate = new Date(mandate.effectiveDate);
    const now = new Date();
    if (effectiveDate > now) {
      return {
        name: 'MANDATE_ACTIVE',
        passed: false,
        details: `Mandate ${mandate.mandateId} is not yet effective (effective date: ${mandate.effectiveDate})`,
      };
    }

    return {
      name: 'MANDATE_ACTIVE',
      passed: true,
      details: `Mandate ${mandate.mandateId} is active and in effect`,
    };
  }
}
