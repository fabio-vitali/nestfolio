import { RelativeTimePipe } from '../../../../src/lib/shared/pipes/relative-time.pipe';

describe('RelativeTimePipe', () => {
  const pipe = new RelativeTimePipe();

  it('returns dash for null', () => {
    expect(pipe.transform(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(pipe.transform(undefined)).toBe('-');
  });

  it('formats a recent date as relative time', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = pipe.transform(fiveMinAgo);
    expect(result).toBeTruthy();
    expect(result).not.toBe('-');
  });

  it('accepts ISO string input', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = pipe.transform(fiveMinAgo);
    expect(result).toBeTruthy();
    expect(result).not.toBe('-');
  });
});
