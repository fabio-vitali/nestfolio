import { forkMerge } from '../../src/util/fork-merge';

describe('forkMerge()', () => {
  const items = [
    { type: 'A', value: 1 },
    { type: 'B', value: 2 },
    { type: 'A', value: 3 },
    { type: 'B', value: 4 },
  ];

  it('routes items to matching branches', async () => {
    const results = await forkMerge(items, [
      { filter: (i) => i.type === 'A', process: async (i) => i.value * 10 },
      { filter: (i) => i.type === 'B', process: async (i) => i.value * 100 },
    ]);

    expect(results[0].results).toEqual([10, 30]);
    expect(results[1].results).toEqual([200, 400]);
  });

  it('collects errors per branch without stopping others', async () => {
    const results = await forkMerge(items, [
      { filter: (i) => i.type === 'A', process: async (i) => {
        if (i.value === 3) throw new Error('boom');
        return i.value;
      }},
      { filter: (i) => i.type === 'B', process: async (i) => i.value },
    ]);

    expect(results[0].results).toEqual([1]);
    expect(results[0].errors).toHaveLength(1);
    expect(results[0].errors[0].error.message).toBe('boom');
    expect(results[1].results).toEqual([2, 4]);
    expect(results[1].errors).toHaveLength(0);
  });

  it('respects per-branch concurrency', async () => {
    let active = 0;
    let maxActive = 0;

    await forkMerge(
      Array.from({ length: 10 }, (_, i) => ({ type: 'A', value: i })),
      [{
        filter: () => true,
        concurrency: 2,
        process: async (i) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
          return i.value;
        },
      }],
    );

    expect(maxActive).toBe(2);
  });

  it('handles empty items', async () => {
    const results = await forkMerge([], [
      { filter: () => true, process: async (i: any) => i },
    ]);
    expect(results[0].results).toEqual([]);
  });
});
