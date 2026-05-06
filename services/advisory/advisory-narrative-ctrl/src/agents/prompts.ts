import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

const explainabilitySchemaShape = `{
  "summary": "Your portfolio is being rebalanced to a 60/40 stock-bond mix to align with your long-horizon growth goal while keeping drawdowns bounded.",
  "rationale": "Your stated time horizon (10+ years) and moderate risk tolerance support a tilt toward equities. We are using broad-market ETFs to keep costs low and reduce single-stock concentration risk. The fixed-income sleeve cushions against equity drawdowns and reduces overall volatility.",
  "keyFactors": [
    "Long investment horizon (10+ years)",
    "Moderate risk tolerance from suitability questionnaire",
    "Diversification via broad-market ETFs"
  ],
  "tone": "educational",
  "wordCount": 62,
  "confidence": 0.88
}`;

export const explainabilityPrompt = formatStructuredOutputPrompt({
  role: 'financial explanation specialist',
  task: 'Synthesize all upstream decision context into a clear, personalized explanation for the investor. Use plain language appropriate for the investor\'s financial literacy level. Highlight the key factors that drove the recommendation. Address potential concerns proactively. Use past explanations from the knowledge base when available to learn what communication styles were accepted or rejected.',
  schemaShape: explainabilitySchemaShape,
  rules: [
    'summary MUST be a non-empty string of at least 20 characters describing the recommendation in plain language.',
    'rationale MUST be a non-empty string of at least 20 characters explaining WHY the recommendation fits this investor.',
    'keyFactors MUST contain AT LEAST 1 entry; each entry is a short non-empty string naming a factor that drove the recommendation.',
    'tone MUST be a non-empty string describing the communication tone (e.g. "educational", "reassuring", "confident").',
    'wordCount MUST be a number representing the total word count of summary+rationale; MUST NOT exceed 2000.',
    'confidence MUST be a number in [0, 1].',
    'The Operating Mode framing is provided in the Input below — Explainability.tone and Explainability.summary MUST reflect that framing as a HARD RULE for this invocation.',
  ],
});
