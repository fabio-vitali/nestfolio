import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

const ACTIVITY_DESCRIPTIONS: Record<string, (payload: Record<string, unknown>) => string> = {
  ORDER_FILLED: (p) => `Order filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  ORDER_PARTIALLY_FILLED: (p) => `Order partially filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  DECISION_APPROVED: (p) => `Decision approved: ${p.decisionId ?? 'unknown'}`,
  DECISION_BLOCKED: (p) => `Decision blocked: ${p.reason ?? p.decisionId ?? 'unknown'}`,
  DEPOSIT_DETECTED: (p) => `Deposit detected: ${((p.amountCents as number) ?? 0) / 100} ${p.currency ?? ''}`.trim(),
  WITHDRAWAL_COMPLETED: (p) => `Withdrawal completed: ${((p.amountCents as number) ?? 0) / 100} ${p.currency ?? ''}`.trim(),
};

export class RecentActivityPipe implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>> {
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as Record<string, unknown>;

    const descriptionFn = ACTIVITY_DESCRIPTIONS[event.type];
    const description = descriptionFn
      ? descriptionFn(payload)
      : `${event.type}: ${JSON.stringify(payload).slice(0, 100)}`;

    const created = await this.repository.addActivity(tenantId, event.id, {
      activityType: event.type,
      description,
      metadata: payload,
    });

    if (!created) {
      logger.info('Activity already exists for this event, skipping', { eventId: event.id });
      return;
    }

    logger.info('Added activity entry', {
      tenantId,
      activityType: event.type,
    });
  }
}
