import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { userRegistered } from '../../../src/transforms/user-registered';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>;

describe('userRegistered transform', () => {
  it('should return project intent for InvestorProfile with pk overrides', () => {
    const uow: TestUow = {
      event: {
        id: 'e1',
        type: 'USER_REGISTERED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: { userId: 'u1', tenantId: 't1', email: 'a@b.c' },
        context: { tenantId: 't1' },
      },
      payload: { userId: 'u1', tenantId: 't1', email: 'a@b.c' },
      record: {},
    };

    expect(userRegistered(uow)).toEqual(
      project('InvestorProfile', { tenantId: 't1', userId: 'u1', email: 'a@b.c' }, {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
      }),
    );
  });
});
