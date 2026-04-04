export function marketResearchFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    signals: [
      { type: 'fallback', ticker: 'SPY', sentiment: 'NEUTRAL', confidence: 0.1, source: 'fallback' },
    ],
    tickersMentioned: ['SPY'],
    marketOutlook: 'Market analysis unavailable — neutral assessment applied as deterministic fallback',
    confidenceScore: 0.1,
  };
}
