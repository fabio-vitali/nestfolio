import { project } from '@nestfolio/event-processor';
import { balanceUpdated } from '../../src/transforms/balance-updated';

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

  it('should return single project intent for balance without snapshot', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      deltaCents: -50_000,
    }) as Parameters<typeof balanceUpdated>[0]);

    expect(result).toEqual(
      project('PortfolioLatest', {
        tenantId: 't1',
        cashBalanceCents: 950_000,
      }, { pk: 'Portfolio#t1', sk: 'Latest' }),
    );
  });

  it('should return array with snapshot intent when snapshot is present', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      deltaCents: -50_000,
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 5,
      },
    }) as Parameters<typeof balanceUpdated>[0]);

    expect(Array.isArray(result)).toBe(true);
    const intents = result as Record<string, unknown>[];
    expect(intents).toHaveLength(2);
    expect(intents[0]._tag).toBe('project');
    expect(intents[0].typename).toBe('PortfolioLatest');
    expect(intents[1]._tag).toBe('project');
    expect(intents[1].typename).toBe('SnapshotAt');
    expect(intents[1].overrides.pk).toBe('SnapshotAt#t1#actual');
  });
});
