import { MarketAnalysisOutputSchema } from '../../../src/agents/schemas';

describe('MarketAnalysisOutputSchema', () => {
  const validData = {
    signals: [
      { type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' },
    ],
    tickersMentioned: ['SPY'],
    marketOutlook: 'Bullish momentum in US equities driven by strong earnings',
    confidenceScore: 0.85,
  };

  it('accepts valid data', () => {
    expect(MarketAnalysisOutputSchema.safeParse(validData).success).toBe(true);
  });

  it('rejects invalid sentiment', () => {
    expect(MarketAnalysisOutputSchema.safeParse({
      ...validData,
      signals: [{ ...validData.signals[0], sentiment: 'VERY_BULLISH' }],
    }).success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    expect(MarketAnalysisOutputSchema.safeParse({ ...validData, confidenceScore: 1.5 }).success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    expect(MarketAnalysisOutputSchema.safeParse({ ...validData, confidenceScore: -0.1 }).success).toBe(false);
  });

  it('accepts empty signals array', () => {
    expect(MarketAnalysisOutputSchema.safeParse({ ...validData, signals: [] }).success).toBe(true);
  });
});
