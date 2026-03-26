import { createHandlers } from '../../src/handlers/event-listener';
import { InvestorBffEventTypes } from '../../src/domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';

describe('investor-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(5);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.USER_REGISTERED);
    expect(handlers).toHaveProperty(InvestorCtrlEventTypes.NOTIFICATION_CREATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.ONBOARDING_COMPLETED);
    expect(handlers).toHaveProperty('GO_LIVE_CONFIRMED');
  });

  it('GO_LIVE_CONFIRMED handler calls setExecutionMode with simulation→live and returns skip', async () => {
    const setExecutionMode = jest.fn().mockResolvedValue({});
    const profileRepo = { setExecutionMode } as any;
    const handlers = createHandlers({ profileRepo });

    const payload = { subject: { tenantId: 'tenant-1', userId: 'user-1' } };
    const ctx = { tenantId: 'tenant-1', userId: 'user-1' };

    const result = await handlers['GO_LIVE_CONFIRMED'](payload, ctx);

    expect(setExecutionMode).toHaveBeenCalledWith('tenant-1', 'user-1', 'simulation', 'live');
    expect(result).toEqual({ _tag: 'skip' });
  });
});
