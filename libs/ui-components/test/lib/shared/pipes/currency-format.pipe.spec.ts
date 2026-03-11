import { CurrencyFormatPipe } from '../../../../src/lib/shared/pipes/currency-format.pipe';

describe('CurrencyFormatPipe', () => {
  const pipe = new CurrencyFormatPipe();

  it('formats a number as EUR currency', () => {
    const result = pipe.transform(1234.56);
    expect(result).toContain('1234,56');
    expect(result).toContain('€');
  });

  it('returns dash for null', () => {
    expect(pipe.transform(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(pipe.transform(undefined)).toBe('-');
  });

  it('formats zero', () => {
    const result = pipe.transform(0);
    expect(result).toContain('0,00');
  });

  it('accepts custom currency', () => {
    const result = pipe.transform(100, 'USD', 'en-US');
    expect(result).toContain('$');
    expect(result).toContain('100.00');
  });
});
