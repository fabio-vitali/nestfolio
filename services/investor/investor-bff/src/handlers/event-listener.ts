// Side-effect import keeps the ReadModelOwnership augmentation explicit and
// resilient if the tsconfig `include` is ever narrowed. The `declare module`
// merge is global across the compilation; this import is not what "activates"
// it — do not infer that other handlers need it.
import '../read-model-ownership';
import { materializeToTable, toUow, skip, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';
import { onboardingCompleted } from '../transforms/onboarding-completed';
import { depositLifecycle } from '../transforms/deposit-lifecycle';
import { withdrawalLifecycle } from '../transforms/withdrawal-lifecycle';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export function createHandlers(deps?: { profileRepo?: InvestorProfileRepository }) {
  return {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload: EventPayload, ctx: EventContext) =>
      userRegistered(toUow(payload, ctx)),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      notificationCreated(toUow(payload, ctx)),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      balanceUpdated(toUow(payload, ctx)),
    // ── funding lifecycle from broker-ctrl (via investor-adpt) → P1 rows ──
    [InvestorBffEventTypes.DEPOSIT_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      depositLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.DEPOSIT_DETECTED]: (payload: EventPayload, ctx: EventContext) =>
      depositLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.DEPOSIT_SETTLED]: (payload: EventPayload, ctx: EventContext) =>
      depositLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.DEPOSIT_FAILED]: (payload: EventPayload, ctx: EventContext) =>
      depositLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.WITHDRAWAL_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      withdrawalLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.WITHDRAWAL_SETTLED]: (payload: EventPayload, ctx: EventContext) =>
      withdrawalLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.WITHDRAWAL_FAILED]: (payload: EventPayload, ctx: EventContext) =>
      withdrawalLifecycle(toUow(payload, ctx)),
    [InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (payload: EventPayload, ctx: EventContext) =>
      onboardingCompleted(payload, ctx),
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
