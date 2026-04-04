export function userGoalsFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    goals: ['General wealth management'],
    timeHorizon: 'Medium-term (5-10 years)',
    riskWillingness: 'moderate',
    confidence: 0.2,
  };
}

export function riskAssessmentFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    riskScore: 50,
    riskCategory: 'MODERATE',
    regulatoryFlags: ['Fallback assessment — manual review recommended'],
    suitabilityAssessment: 'Deterministic fallback: moderate risk profile applied pending manual review.',
    confidence: 0.2,
  };
}
