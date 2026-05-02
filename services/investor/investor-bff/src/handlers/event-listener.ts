import { materializeToTable, toUow, skip, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';
import { onboardingCompleted } from '../transforms/onboarding-completed';
import { operatingModeChanged } from '../transforms/operating-mode-changed';
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
    [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) =>
      operatingModeChanged(payload, ctx),
    [InvestorBffEventTypes.GO_LIVE_CONFIRMED]: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      const reqCtx = { ...pickRequestContext(ctx), userId: (subject.userId as string) as typeof ctx.userId };
      const profileRepo = deps?.profileRepo ?? new InvestorProfileRepository(process.env['TABLE_NAME']!);
      await profileRepo.setExecutionMode(reqCtx, 'simulation', 'live');
      return skip();
    },
  };
}

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: createHandlers(),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
