import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

type OrderFilledPayload = {
  orderId: string;
  brokerOrderId: string;
  filledQuantity: number;
  averageFillPrice: number;
  filledAt: string;
};

export class PortfolioSummaryPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: DashboardRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as OrderFilledPayload & Record<string, unknown>;

    const extraUpdates: Record<string, number> = {};

    if (payload.driftPercent !== undefined) {
      extraUpdates.driftPercent = payload.driftPercent as number;
    }

    if (payload.filledQuantity !== undefined && payload.averageFillPrice !== undefined) {
      const tradeValueCents = Math.round(
        payload.filledQuantity * payload.averageFillPrice * 100,
      );

      const processed = await this.repository.guardedAtomicIncrementTotalValue(
        tenantId, event.id, 'portfolioSummary', tradeValueCents, extraUpdates,
      );
      if (!processed) {
        logger.info('Portfolio summary already updated for this event, skipping', { eventId: event.id });
        return;
      }
    } else if (Object.keys(extraUpdates).length > 0) {
      await this.repository.upsertPortfolioSummary(tenantId, extraUpdates);
    }

    logger.info('Updated portfolio summary projection', {
      tenantId,
      eventType: event.type,
    });
  }
}
