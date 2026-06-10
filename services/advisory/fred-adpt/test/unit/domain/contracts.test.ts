import { FredIndicatorSchema } from '../../../src/domain/contracts';

describe('FredIndicatorSchema', () => {
  const validIndicator = {
    seriesId: 'FEDFUNDS',
    label: 'Federal Funds Rate',
    date: '2026-04-04',
    value: '5.33',
  };

  it('parses a real FRED indicator fields object', () => {
    const result = FredIndicatorSchema.parse(validIndicator);
    expect(result.seriesId).toBe('FEDFUNDS');
    expect(result.value).toBe('5.33');
  });

  it('parses all tracked series shapes', () => {
    const cpi = { seriesId: 'CPIAUCSL', label: 'CPI (Inflation)', date: '2026-04-04', value: '314.069' };
    const result = FredIndicatorSchema.parse(cpi);
    expect(result.seriesId).toBe('CPIAUCSL');
  });

  it('rejects a missing seriesId', () => {
    const { seriesId: _, ...noSeriesId } = validIndicator;
    expect(() => FredIndicatorSchema.parse(noSeriesId)).toThrow();
  });

  it('rejects a numeric value (must be string)', () => {
    expect(() =>
      FredIndicatorSchema.parse({ ...validIndicator, value: 5.33 }),
    ).toThrow();
  });
});
