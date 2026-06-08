import { z } from 'zod';
import { balanceUpdated } from '../../../src/transforms/balance-updated';

describe('balanceUpdated transform', () => {
  const pos = (symbol: string) => ({
    symbol, quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155,
  });

  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'BALANCE_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  const validSubject = {
    tenantId: 't1',
    userId: 'u1',
    cashBalanceCents: 950_000,
    snapshot: {
      positions: { VTI: pos('VTI') },
      cashBalanceCents: 950_000,
      lastEventSequence: 7,
    },
  };

  it('writes a versioned PortfolioLatest projection keyed on snapshot.lastEventSequence', () => {
    const result = balanceUpdated(makeUow(validSubject) as Parameters<typeof balanceUpdated>[0]);

    const intents = (Array.isArray(result) ? result : [result]) as Array<Record<string, unknown>>;
    const latest = intents.find((i) => i.typename === 'PortfolioLatest');
    expect(latest).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'PortfolioLatest',
      version: 7,
      overrides: { pk: 'Portfolio#t1', sk: 'Latest' },
    });
    expect((latest!.fields as Record<string, unknown>).cashBalanceCents).toBe(950_000);
  });

  it('writes SnapshotAt as an append-only record (P2) alongside PortfolioLatest', () => {
    const result = balanceUpdated(makeUow(validSubject) as Parameters<typeof balanceUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    expect(Array.isArray(intents)).toBe(true);
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
      balanceUpdated(makeUow({ tenantId: 't1', cashBalanceCents: 500_000 }) as Parameters<typeof balanceUpdated>[0]),
    ).toThrow(z.ZodError);
  });

  it('throws ZodError when tenantId is absent', () => {
    expect(() =>
      balanceUpdated(makeUow({ cashBalanceCents: 500_000, snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence: 1 } }) as Parameters<typeof balanceUpdated>[0]),
    ).toThrow(z.ZodError);
  });
});
