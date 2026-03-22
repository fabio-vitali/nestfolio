import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload, ctx) =>
      userRegistered(toUow(payload, ctx) as any),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload, ctx) =>
      notificationCreated(toUow(payload, ctx) as any),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload, ctx) =>
      balanceUpdated(toUow(payload, ctx) as any),
  },
  errorEventType: 'INVESTOR_BFF_FAILED',
});
