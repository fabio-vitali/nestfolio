import { waitForGraphQL } from '../../src/helpers/wait-for-graphql';

describe('waitForGraphQL', () => {
  const QUERY = 'query X { dummy { n } }';

  it('returns the first result that satisfies the predicate', async () => {
    let calls = 0;
    const client = {
      query: jest.fn(async () => ({ dummy: { n: ++calls } })),
    };

    const result = await waitForGraphQL<{ dummy: { n: number } }>(
      client as any,
      QUERY,
      { id: 'x' },
      (r) => r.dummy.n >= 3,
      { timeoutMs: 5_000, intervalMs: 10 },
    );

    expect(result.dummy.n).toBe(3);
    expect(client.query).toHaveBeenCalledWith(QUERY, { id: 'x' });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('throws if the predicate never succeeds within timeoutMs', async () => {
    const client = { query: jest.fn(async () => ({ dummy: { n: 0 } })) };

    await expect(waitForGraphQL<{ dummy: { n: number } }>(
      client as any,
      QUERY,
      {},
      (r) => r.dummy.n > 5,
      { timeoutMs: 50, intervalMs: 10 },
    )).rejects.toThrow(/timed out/);
  });
});
