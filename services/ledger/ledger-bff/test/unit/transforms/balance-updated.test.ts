import { balanceUpdated } from '../../../src/transforms/balance-updated';

describe('balanceUpdated transform', () => {
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

  it('writes a versioned PortfolioLatest projection keyed on snapshot.lastEventSequence', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      deltaCents: -50_000,
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 7,
      },
    }) as Parameters<typeof balanceUpdated>[0]);

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

  it('writes SnapshotAt as an append-only record (P2) when snapshot is present', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 7,
      },
    }) as Parameters<typeof balanceUpdated>[0]);

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

  it('defaults version to 0 when no snapshot present (legacy/simplified event)', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 500_000,
    }) as Parameters<typeof balanceUpdated>[0]);

    const intent = result as Record<string, unknown>;
    expect(intent).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'PortfolioLatest',
      version: 0,
    });
  });
});
