import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';
import { onboardingCompleted } from '../transforms/onboarding-completed';

export function createHandlers() {
  return {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload: any, ctx: any) =>
      userRegistered(toUow(payload, ctx) as any),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload: any, ctx: any) =>
      notificationCreated(toUow(payload, ctx) as any),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload: any, ctx: any) =>
      balanceUpdated(toUow(payload, ctx) as any),
    [InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (payload: any, ctx: any) =>
      onboardingCompleted(payload, ctx),
  };
}

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: createHandlers(),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
