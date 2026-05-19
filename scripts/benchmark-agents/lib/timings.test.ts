import { asRate, hrtimeMsAround, median } from './timings';

describe('median', () => {
  it('returns middle of odd-length array', () => {
    expect(median([1, 5, 3])).toBe(3);
  });
  it('returns mean of two middles on even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('throws on empty array', () => {
    expect(() => median([])).toThrow();
  });
});

describe('asRate', () => {
  it('formats numerator/denominator', () => {
    expect(asRate(3, 3)).toBe('3/3');
    expect(asRate(0, 3)).toBe('0/3');
  });
});

describe('hrtimeMsAround', () => {
  it('measures elapsed ms of async function', async () => {
    const { ms, value } = await hrtimeMsAround(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 42;
    });
    expect(value).toBe(42);
    expect(ms).toBeGreaterThanOrEqual(25);
    expect(ms).toBeLessThan(500);
  });
});
