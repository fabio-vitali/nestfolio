import type { ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';

interface ExplainabilityOutput {
  summary: string;
  rationale: string;
  keyFactors: string[];
  tone: string;
  wordCount: number;
  confidence: number;
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors };
}

export const narrativeValidationRule: ValidationRule<ExplainabilityOutput> = {
  validate(output: ExplainabilityOutput): ValidationResult {
    const errors: string[] = [];

    if (output.summary.length < 20) {
      errors.push(`summary length ${output.summary.length} must be >= 20 characters`);
    }

    if (output.rationale.length < 20) {
      errors.push(`rationale length ${output.rationale.length} must be >= 20 characters`);
    }

    if (output.keyFactors.length < 1) {
      errors.push('At least 1 key factor is required');
    }

    if (output.wordCount < 0) {
      errors.push(`wordCount ${output.wordCount} must be >= 0`);
    }

    if (output.wordCount > 2000) {
      errors.push(`wordCount ${output.wordCount} exceeds 2000 word limit`);
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
