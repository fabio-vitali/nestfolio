import { computeRiskProfile } from '../../../src/domain/risk-profile.service';

describe('computeRiskProfile', () => {
  it('returns conservative for low tolerance + low experience', () => {
    const result = computeRiskProfile(0, 0);
    expect(result.category).toBe('conservative');
    expect(result.tolerance).toBe('hold');
    expect(result.experienceLevel).toBe('novice');
    expect(result.score).toBeLessThan(34);
  });

  it('returns aggressive for high tolerance + high experience', () => {
    const result = computeRiskProfile(3, 3);
    expect(result.category).toBe('aggressive');
    expect(result.score).toBeGreaterThanOrEqual(67);
  });

  it('returns moderate for mixed indices', () => {
    const result = computeRiskProfile(2, 1);
    expect(result.category).toBe('moderate');
  });
});
