import type { ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';

interface GoalsOutput {
  goals: string[];
  timeHorizon: string;
  riskWillingness: string;
  confidence: number;
}

interface RiskOutput {
  riskScore: number;
  riskCategory: string;
  regulatoryFlags: string[];
  suitabilityAssessment: string;
  confidence: number;
}

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(errors: string[]): ValidationResult { return { valid: false, errors }; }

export const goalsValidationRule: ValidationRule<GoalsOutput> = {
  validate(output: GoalsOutput): ValidationResult {
    const errors: string[] = [];

    if (output.goals.length < 1) {
      errors.push('At least 1 goal is required');
    }

    if (!output.timeHorizon || output.timeHorizon.length === 0) {
      errors.push('timeHorizon must not be empty');
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};

export const riskValidationRule: ValidationRule<RiskOutput> = {
  validate(output: RiskOutput): ValidationResult {
    const errors: string[] = [];

    if (output.riskScore < 20 && output.riskCategory === 'AGGRESSIVE') {
      errors.push(`riskScore ${output.riskScore} is inconsistent with category 'AGGRESSIVE'`);
    }

    if (output.riskScore > 80 && output.riskCategory === 'CONSERVATIVE') {
      errors.push(`riskScore ${output.riskScore} is inconsistent with category 'CONSERVATIVE'`);
    }

    if (output.suitabilityAssessment.length < 10) {
      errors.push(`suitabilityAssessment length ${output.suitabilityAssessment.length} must be >= 10 characters`);
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
