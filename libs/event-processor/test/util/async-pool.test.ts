import { asyncPool } from '../../src/util/async-pool';

describe('asyncPool()', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await asyncPool(items, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('limits concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await asyncPool(items, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n;
    }, { concurrency: 2 });

    expect(maxActive).toBe(2);
  });

  it('defaults to concurrency 5', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await asyncPool(items, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });

    expect(maxActive).toBe(5);
  });

  it('handles empty array', async () => {
    const results = await asyncPool([], async (n: number) => n);
    expect(results).toEqual([]);
  });

  it('propagates errors', async () => {
    await expect(
      asyncPool([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
