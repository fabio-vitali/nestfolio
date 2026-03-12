import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { PortfolioRepository, type PositionRecord } from '../repositories/portfolio.repository';

type PortfolioPayload = {
  positions: Record<string, PositionRecord>;
};

export class PortfolioUpdatedPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as PortfolioPayload & Record<string, unknown>;

    const positions = payload.positions ?? {};

    for (const [symbol, position] of Object.entries(positions)) {
      await this.repository.upsertPosition(tenantId, symbol, {
        symbol,
        quantity: position.quantity ?? 0,
        averageCostBasis: position.averageCostBasis ?? 0,
        totalCostBasis: position.totalCostBasis ?? 0,
        lastFillPrice: position.lastFillPrice ?? 0,
      });
    }

    logger.info('Updated portfolio positions projection', {
      tenantId,
      eventType: event.type,
      positionCount: Object.keys(positions).length,
    });
  }
}
