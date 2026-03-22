import { record } from '@nestfolio/event-processor';
import { userRegistered } from '../../src/transforms/user-registered';

describe('userRegistered transform', () => {
  it('should return record intent for InvestorProfile', () => {
    const uow = {
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

    expect(userRegistered(uow as any)).toEqual(
      record('InvestorProfile', { tenantId: 't1', userId: 'u1', email: 'a@b.c' }),
    );
  });
});
