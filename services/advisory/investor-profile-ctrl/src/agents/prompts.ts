import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

const userGoalsSchemaShape = `{
  "goals": [
    "Retirement at age 65 with target $1.5M nest egg",
    "Down-payment savings for first home in 5-7 years"
  ],
  "timeHorizon": "10+ years",
  "riskWillingness": "moderate",
  "confidence": 0.84
}`;

export const userGoalsPrompt = formatStructuredOutputPrompt({
  role: 'investor goals analyst',
  task: 'Given the investor profile and portfolio state, interpret the investor\'s financial goals, time horizon, and stated risk willingness. Use plain-language goal statements, not formula-derived numbers.',
  schemaShape: userGoalsSchemaShape,
  rules: [
    'goals MUST be a non-empty array of plain-language strings naming each financial goal (retirement, education, wealth preservation, home purchase, etc.).',
    'timeHorizon MUST be a non-empty string describing the investment horizon (e.g. "5-10 years", "10+ years", "<3 years").',
    'riskWillingness MUST be a non-empty string describing the investor\'s stated risk appetite (e.g. "low", "moderate", "high"). This is the STATED preference — the regulatory risk score lives in the risk-assessment agent.',
    'confidence MUST be a number in [0, 1] reflecting how clearly the investor profile signals these goals.',
  ],
});

const riskAssessmentSchemaShape = `{
  "riskScore": 55,
  "riskCategory": "MODERATE",
  "regulatoryFlags": [
    "FINRA 2111 Suitability: investor net worth supports proposed exposure"
  ],
  "suitabilityAssessment": "The proposed allocation is suitable under FINRA Rule 2111. The investor\\'s 10-year horizon, moderate stated risk tolerance, and stable income support a 60/40 stock-bond mix. No Reg BI conflicts identified.",
  "confidence": 0.86
}`;

export const riskAssessmentPrompt = formatStructuredOutputPrompt({
  role: 'regulatory risk assessment specialist',
  task: 'Given the investor profile and portfolio state, evaluate the risk profile against regulatory frameworks (FINRA 2111 Suitability, SEC Reg BI). Produce a numeric risk score, a categorical risk band, and a suitability narrative.',
  schemaShape: riskAssessmentSchemaShape,
  rules: [
    'riskScore MUST be a number in [0, 100] where 0 is very conservative and 100 is very aggressive.',
    'riskCategory MUST be exactly one of CONSERVATIVE | MODERATE | AGGRESSIVE.',
    'regulatoryFlags MUST be an array of strings. Empty array is acceptable when no concerns are identified — but the array MUST be present in the output.',
    'suitabilityAssessment MUST be a non-empty narrative string explaining whether the investor profile is suitable under the applicable regulatory framework, and citing the framework by name (FINRA 2111, Reg BI, etc.).',
    'confidence MUST be a number in [0, 1] reflecting how strongly the data supports this assessment.',
  ],
});
