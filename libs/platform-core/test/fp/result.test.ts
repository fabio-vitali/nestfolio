import { ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch, type Result } from '../../src/fp/result';

describe('Result', () => {
  describe('ok / err constructors', () => {
    it('should create an ok result', () => {
      const r = ok(42);
      expect(r).toEqual({ ok: true, value: 42 });
    });

    it('should create an err result', () => {
      const r = err('something failed');
      expect(r).toEqual({ ok: false, error: 'something failed' });
    });
  });

  describe('isOk / isErr type guards', () => {
    it('should identify ok results', () => {
      const r: Result<number, string> = ok(1);
      expect(isOk(r)).toBe(true);
      expect(isErr(r)).toBe(false);
    });

    it('should identify err results', () => {
      const r: Result<number, string> = err('fail');
      expect(isOk(r)).toBe(false);
      expect(isErr(r)).toBe(true);
    });

    it('should narrow type in ok branch', () => {
      const r: Result<number, string> = ok(42);
      if (isOk(r)) {
        expect(r.value).toBe(42);
      } else {
        fail('Expected ok');
      }
    });

    it('should narrow type in err branch', () => {
      const r: Result<number, string> = err('oops');
      if (isErr(r)) {
        expect(r.error).toBe('oops');
      } else {
        fail('Expected err');
      }
    });
  });

  describe('mapResult', () => {
    it('should transform the value of an ok result', () => {
      const r = mapResult(ok(5), (n) => n * 2);
      expect(r).toEqual({ ok: true, value: 10 });
    });

    it('should pass through an err result unchanged', () => {
      const r = mapResult(err('fail') as Result<number, string>, (n) => n * 2);
      expect(r).toEqual({ ok: false, error: 'fail' });
    });
  });

  describe('flatMapResult', () => {
    const safeDivide = (a: number, b: number): Result<number, string> =>
      b === 0 ? err('division by zero') : ok(a / b);

    it('should chain ok results', () => {
      const r = flatMapResult(ok(10), (n) => safeDivide(n, 2));
      expect(r).toEqual({ ok: true, value: 5 });
    });

    it('should short-circuit on err', () => {
      const r = flatMapResult(err('initial error') as Result<number, string>, (n) => safeDivide(n, 2));
      expect(r).toEqual({ ok: false, error: 'initial error' });
    });

    it('should propagate err from the chained function', () => {
      const r = flatMapResult(ok(10), (n) => safeDivide(n, 0));
      expect(r).toEqual({ ok: false, error: 'division by zero' });
    });
  });

  describe('tryCatch', () => {
    it('should return ok when the async function succeeds', async () => {
      const r = await tryCatch(() => Promise.resolve(42));
      expect(r).toEqual({ ok: true, value: 42 });
    });

    it('should return err when the async function throws', async () => {
      const r = await tryCatch(() => Promise.reject(new Error('boom')));
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error).toBeInstanceOf(Error);
        expect((r.error as Error).message).toBe('boom');
      }
    });

    it('should use mapError to transform the caught error', async () => {
      const r = await tryCatch(
        () => Promise.reject(new Error('boom')),
        (e) => `Mapped: ${(e as Error).message}`,
      );
      expect(r).toEqual({ ok: false, error: 'Mapped: boom' });
    });

    it('should handle non-Error throws with mapError', async () => {
      const r = await tryCatch(
        () => Promise.reject('string error'),
        (e) => String(e),
      );
      expect(r).toEqual({ ok: false, error: 'string error' });
    });
  });
});
