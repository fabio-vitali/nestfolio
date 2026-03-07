import Highland from 'highland';
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
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>, void>
{
  constructor(private readonly repository: DashboardRepository) {}

  feed(
    source: Highland.Stream<UnitOfWork<BusEvent<Record<string, unknown>>>>,
  ): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const tenantId = (event.context as Record<string, string>).tenantId;
          const payload = event.subject as OrderFilledPayload & Record<string, unknown>;

          const updates: Record<string, number> = {};

          if (payload.filledQuantity !== undefined && payload.averageFillPrice !== undefined) {
            updates.totalValueCents = Math.round(
              payload.filledQuantity * payload.averageFillPrice * 100,
            );
          }

          if (payload.driftPercent !== undefined) {
            updates.driftPercent = payload.driftPercent as number;
          }

          await this.repository.upsertPortfolioSummary(tenantId, updates);

          logger.info('Updated portfolio summary projection', {
            tenantId,
            eventType: event.type,
          });
        })(),
      ),
    );
  }
}
