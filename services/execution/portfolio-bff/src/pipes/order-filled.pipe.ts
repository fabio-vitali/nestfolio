import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { PortfolioRepository } from '../repositories/portfolio.repository';

type OrderFilledPayload = {
  tenantId: string;
  portfolioId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  filledQuantity: number;
  averageFillPrice: number;
};

export class OrderFilledPipe implements Pipe<UnitOfWork<BusEvent<OrderFilledPayload>>, void> {
  constructor(private readonly repository: PortfolioRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<OrderFilledPayload>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const payload = event.subject;
          const { tenantId, portfolioId, symbol, side, filledQuantity, averageFillPrice } = payload;

          const pid = portfolioId ?? tenantId;

          // Get existing position or default
          const existing = await this.repository.getPosition(tenantId, pid, symbol);
          const currentQty = (existing?.quantity as number) ?? 0;
          const currentAvgCost = (existing?.avgCostBasis as number) ?? 0;

          let newQty: number;
          let newAvgCost: number;

          if (side === 'BUY') {
            newQty = currentQty + filledQuantity;
            // Weighted average cost basis
            newAvgCost =
              newQty !== 0
                ? (currentQty * currentAvgCost + filledQuantity * averageFillPrice) / newQty
                : 0;
          } else {
            newQty = currentQty - filledQuantity;
            newAvgCost = currentAvgCost; // avg cost doesn't change on sells
          }

          await this.repository.upsertPosition(
            tenantId,
            pid,
            symbol,
            newQty,
            newAvgCost,
            averageFillPrice,
          );

          logger.info('Updated position on order fill', {
            tenantId,
            symbol,
            side,
            newQty,
            newAvgCost,
          });
        })(),
      ),
    );
  }
}
