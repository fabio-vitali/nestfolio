import { z } from 'zod';
import { portfolioUpdated } from '../../../src/transforms/portfolio-updated';

describe('portfolioUpdated transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'PORTFOLIO_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  const pos = (symbol: string) => ({
    symbol, quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155,
  });

  it('writes versioned Position projections keyed on snapshot.lastEventSequence', () => {
    const result = portfolioUpdated(makeUow({
      tenantId: 't1',
      positions: { AAPL: pos('AAPL'), MSFT: pos('MSFT') },
      snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 12 },
    }) as Parameters<typeof portfolioUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    const positions = intents.filter((i) => i.typename === 'Position');
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(p._tag).toBe('projectVersioned');
      expect(p.version).toBe(12);
    }
    const aapl = positions.find((p) => (p.overrides as Record<string, string>).sk === 'Position#AAPL');
    expect(aapl).toMatchObject({ overrides: { pk: 'Portfolio#t1', sk: 'Position#AAPL' } });
    expect((aapl!.fields as Record<string, unknown>).quantity).toBe(10);
  });

  it('writes SnapshotAt as an append-only record (P2) alongside Position projections', () => {
    const result = portfolioUpdated(makeUow({
      tenantId: 't1',
      positions: { AAPL: pos('AAPL') },
      snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 12 },
    }) as Parameters<typeof portfolioUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    expect(intents).toHaveLength(2);
    const snap = intents.find((i) => i.typename === 'SnapshotAt');
    expect(snap).toMatchObject({
      _tag: 'record',
      typename: 'SnapshotAt',
      overrides: { pk: 'SnapshotAt#t1#actual', sk: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('throws ZodError when the subject violates the ledger contract (missing snapshot)', () => {
    expect(() =>
      portfolioUpdated(makeUow({ tenantId: 't1', positions: { AAPL: pos('AAPL') } }) as Parameters<typeof portfolioUpdated>[0]),
    ).toThrow(z.ZodError);
  });
});
