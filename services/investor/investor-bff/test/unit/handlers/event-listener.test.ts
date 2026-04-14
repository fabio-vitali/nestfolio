import { createHandlers } from '../../../src/handlers/event-listener';
import { InvestorBffEventTypes } from '../../../src/domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import type { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

describe('investor-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(6);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.USER_REGISTERED);
    expect(handlers).toHaveProperty(InvestorCtrlEventTypes.NOTIFICATION_CREATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.ONBOARDING_COMPLETED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.OPERATING_MODE_CHANGED);
    expect(handlers).toHaveProperty('GO_LIVE_CONFIRMED');
  });

  it('GO_LIVE_CONFIRMED handler calls setExecutionMode with simulation→live and returns skip', async () => {
    const setExecutionMode = jest.fn().mockResolvedValue({});
    const profileRepo = { setExecutionMode } as unknown as InvestorProfileRepository;
    const handlers = createHandlers({ profileRepo });

    // userId in subject differs from ctx to prove handler uses subject.userId
    const payload = { subject: { tenantId: 'tenant-1', userId: 'subject-user' } };
    const ctx = { tenantId: 'tenant-1', userId: 'ctx-user', region: 'us-east-1' };

    const result = await handlers['GO_LIVE_CONFIRMED'](payload, ctx);

    expect(setExecutionMode).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'subject-user', region: 'us-east-1' }, 'simulation', 'live');
    expect(result).toEqual({ _tag: 'skip' });
  });
});
