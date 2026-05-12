import { jitter } from '../src/timing';

describe('jitter', () => {
  it('returns mean * 0.75 at random=0 (floor)', () => {
    expect(jitter(500, () => 0)).toBeCloseTo(375);
  });

  it('returns mean * 1.0 at random=0.5 (mean)', () => {
    expect(jitter(500, () => 0.5)).toBeCloseTo(500);
  });

  it('approaches mean * 1.25 at random=0.999 (ceiling, exclusive)', () => {
    expect(jitter(500, () => 0.999)).toBeCloseTo(624.75, 1);
  });

  it('stays within [0.75x, 1.25x) for arbitrary mean', () => {
    expect(jitter(1000, () => 0)).toBeCloseTo(750);
    expect(jitter(1000, () => 0.999)).toBeCloseTo(1249.5, 1);
  });

  it('uses Math.random by default', () => {
    const v = jitter(500);
    expect(v).toBeGreaterThanOrEqual(375);
    expect(v).toBeLessThan(625);
  });
});
