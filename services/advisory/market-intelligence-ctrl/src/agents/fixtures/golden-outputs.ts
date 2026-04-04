export const GOLDEN_MARKET_ANALYSIS = {
  signals: [
    { type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH' as const, confidence: 0.75, source: 'technical-analysis' },
    { type: 'fundamental', ticker: 'VTI', sentiment: 'BULLISH' as const, confidence: 0.7, source: 'earnings-data' },
    { type: 'sentiment', ticker: 'BND', sentiment: 'NEUTRAL' as const, confidence: 0.6, source: 'macro-indicators' },
  ],
  tickersMentioned: ['SPY', 'VTI', 'BND'],
  marketOutlook: 'Moderately bullish outlook driven by strong Q1 corporate earnings and stable employment data. Fed rate trajectory suggests continued equity-favorable conditions with modest fixed-income headwinds.',
  confidenceScore: 0.78,
};
