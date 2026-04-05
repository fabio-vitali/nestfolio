import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { balanceUpdated } from '../../src/transforms/balance-updated';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>;

describe('balanceUpdated transform', () => {
  it('should return project intent for CashBalance with custom key overrides', () => {
    const uow: TestUow = {
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

    expect(balanceUpdated(uow)).toEqual(
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
