export function narrativeFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    summary: 'A standard explanation has been generated based on available portfolio and decision data.',
    rationale: 'Automated fallback: the explanation agent was unable to generate a personalized narrative at this time.',
    keyFactors: ['Fallback explanation applied', 'Personalized analysis unavailable'],
    tone: 'neutral',
    wordCount: 0,
    confidence: 0.2,
  };
}
