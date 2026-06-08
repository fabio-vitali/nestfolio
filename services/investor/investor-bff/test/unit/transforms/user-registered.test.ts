import { skip } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { userRegistered } from '../../../src/transforms/user-registered';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('userRegistered transform', () => {
  it('returns skip() — onboarding-completed is the sole InvestorProfile writer', () => {
    // Pre-creating a sparse InvestorProfile row here would race with
    // onboarding's atomic Put and surface as INVESTOR_PROFILE_UPDATED
    // (MODIFY) in CDC instead of INVESTOR_PROFILE_CREATED (INSERT).
    const uow = {
      event: {
        id: 'e1',
        type: 'USER_REGISTERED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: { email: 'a@b.c' },
        context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      },
      payload: { email: 'a@b.c' },
      record: {},
    } as unknown as TestUow;

    expect(userRegistered(uow)).toEqual(skip());
  });
});
