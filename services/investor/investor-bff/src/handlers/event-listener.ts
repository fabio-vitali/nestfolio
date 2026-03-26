import { materializeToTable, toUow, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';
import { onboardingCompleted } from '../transforms/onboarding-completed';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export function createHandlers(deps?: { profileRepo?: InvestorProfileRepository }) {
  return {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload: EventPayload, ctx: EventContext) =>
      userRegistered(toUow(payload, ctx)),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      notificationCreated(toUow(payload, ctx)),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      balanceUpdated(toUow(payload, ctx)),
    [InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (payload: EventPayload, ctx: EventContext) =>
      onboardingCompleted(payload, ctx),
    ['GO_LIVE_CONFIRMED']: async (_payload: EventPayload, ctx: EventContext) => {
      const profileRepo = deps?.profileRepo ?? new InvestorProfileRepository(process.env['TABLE_NAME']!);
      await profileRepo.setExecutionMode(ctx.tenantId, ctx.userId, 'simulation', 'live');
      return skip();
    },
  };
}

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: createHandlers(),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
