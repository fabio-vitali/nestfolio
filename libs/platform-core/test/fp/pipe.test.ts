import { pipe } from '../../src/fp/pipe';

describe('pipe', () => {
  it('should apply a single transformation', () => {
    const result = pipe(2, (x) => x * 3);
    expect(result).toBe(6);
  });

  it('should chain two transformations left-to-right', () => {
    const result = pipe(
      'hello',
      (s) => s.toUpperCase(),
      (s) => s + '!',
    );
    expect(result).toBe('HELLO!');
  });

  it('should chain multiple transformations', () => {
    const result = pipe(
      10,
      (n) => n + 5,
      (n) => n * 2,
      (n) => String(n),
    );
    expect(result).toBe('30');
  });

  it('should handle type changes across stages', () => {
    const result = pipe(
      [1, 2, 3],
      (arr) => arr.length,
      (n) => n > 2,
      (b) => (b ? 'yes' : 'no'),
    );
    expect(result).toBe('yes');
  });

  it('should support up to 8 stages', () => {
    const result = pipe(
      1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
      (n) => n + 1,
    );
    expect(result).toBe(9);
  });

  it('should pass through null and undefined', () => {
    const result = pipe(
      null as string | null,
      (v) => v ?? 'default',
    );
    expect(result).toBe('default');
  });
});
