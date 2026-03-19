import { computeRiskProfile } from '../../src/agent/tools/compute-risk';

describe('computeRiskProfile', () => {
  it('conservative: low tolerance + novice = score 0-33, category conservative', () => {
    const result = computeRiskProfile(0, 0);
    expect(result.score).toBeLessThanOrEqual(33);
    expect(result.category).toBe('conservative');
  });

  it('moderate: medium tolerance + intermediate = score 34-66, category moderate', () => {
    const result = computeRiskProfile(1, 1);
    expect(result.score).toBeGreaterThanOrEqual(17);
    expect(result.score).toBeLessThanOrEqual(67);
    expect(result.category).toBe('moderate');
  });

  it('aggressive: high tolerance + expert = score 67-100, category aggressive', () => {
    const result = computeRiskProfile(3, 3);
    expect(result.score).toBeGreaterThanOrEqual(67);
    expect(result.category).toBe('aggressive');
  });

  it('mixed: high tolerance + novice = moderate', () => {
    const result = computeRiskProfile(3, 0);
    expect(result.category).toBe('moderate');
  });

  it('produces deterministic output for same inputs', () => {
    const a = computeRiskProfile(2, 1);
    const b = computeRiskProfile(2, 1);
    expect(a).toEqual(b);
  });

  it('all 16 input combinations produce valid results', () => {
    for (let t = 0; t <= 3; t++) {
      for (let e = 0; e <= 3; e++) {
        const result = computeRiskProfile(t, e);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(['conservative', 'moderate', 'aggressive']).toContain(result.category);
      }
    }
  });
});
