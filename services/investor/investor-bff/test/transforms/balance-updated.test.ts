import { project } from '@nestfolio/event-processor';
import { balanceUpdated } from '../../src/transforms/balance-updated';

describe('balanceUpdated transform', () => {
  it('should return project intent for CashBalance with custom key overrides', () => {
    const uow = {
      event: {
        id: 'e1',
        type: 'BALANCE_UPDATED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', userId: 'u1', cashBalanceCents: 500_000 },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(balanceUpdated(uow as any)).toEqual(
      project('CashBalance', {
        tenantId: 't1',
        userId: 'u1',
        cashBalanceCents: 500_000,
      }, {
        pk: 'InvestorProfile#t1#u1',
        sk: 'CashBalance',
      }),
    );
  });
});
