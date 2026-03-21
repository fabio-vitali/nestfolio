import { PercentFormatPipe } from '../../../src/shared/pipes/percent-format.pipe';

describe('PercentFormatPipe', () => {
  const pipe = new PercentFormatPipe();

  it('formats a decimal as percentage', () => {
    const result = pipe.transform(0.1234);
    expect(result).toContain('12,34');
    expect(result).toContain('%');
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
    expect(result).toContain('%');
  });

  it('accepts custom decimals', () => {
    const result = pipe.transform(0.5, 0);
    expect(result).toContain('50');
    expect(result).toContain('%');
  });
});
