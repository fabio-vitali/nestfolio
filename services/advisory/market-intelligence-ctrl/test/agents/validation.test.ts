import { marketResearchValidationRule } from '../../src/agents/validation';

describe('Market research validation', () => {
  const validOutput = {
    signals: [
      { type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' },
      { type: 'fundamental', ticker: 'VTI', sentiment: 'NEUTRAL', confidence: 0.6, source: 'earnings' },
    ],
    tickersMentioned: ['SPY', 'VTI'],
    marketOutlook: 'Moderately bullish outlook driven by strong corporate earnings and stable macro indicators',
    confidenceScore: 0.75,
  };

  it('passes valid output', () => {
    expect(marketResearchValidationRule.validate(validOutput).valid).toBe(true);
  });

  it('fails when signals is empty', () => {
    const r = marketResearchValidationRule.validate({ ...validOutput, signals: [] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('signal');
  });

  it('fails with duplicate tickers in signals', () => {
    const r = marketResearchValidationRule.validate({
      ...validOutput,
      signals: [
        { type: 'a', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'x' },
        { type: 'b', ticker: 'SPY', sentiment: 'BEARISH', confidence: 0.6, source: 'y' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('Duplicate');
  });

  it('fails when marketOutlook is too short', () => {
    const r = marketResearchValidationRule.validate({ ...validOutput, marketOutlook: 'Short' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('marketOutlook');
  });

  it('fails when tickersMentioned is inconsistent with signals', () => {
    const r = marketResearchValidationRule.validate({
      ...validOutput,
      tickersMentioned: ['AAPL'],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('tickersMentioned');
  });
});
