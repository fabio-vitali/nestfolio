import { type Pipe, type UnitOfWork, type BusEvent, logger, NotRetryableError } from '@nestfolio/platform-core';
import { PortfolioRepository } from '../repositories/portfolio.repository';

const MAX_RETRIES = 3;

type OrderFilledPayload = {
  tenantId: string;
  portfolioId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  filledQuantity: number;
  averageFillPrice: number;
};

export class OrderFilledPipe implements Pipe<UnitOfWork<BusEvent<OrderFilledPayload>>> {
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<OrderFilledPayload>>): Promise<void> {
    const { event } = uow;
    const payload = event.subject;
    const { tenantId, portfolioId, symbol, side, filledQuantity, averageFillPrice } = payload;

    const pid = portfolioId ?? tenantId;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Get existing position or default
      const existing = await this.repository.getPosition(tenantId, pid, symbol);
      const currentQty = existing?.quantity ?? 0;
      const currentAvgCost = existing?.avgCostBasis ?? 0;
      const currentVersion = existing?.version as number | undefined;

      let newQty: number;
      let newAvgCost: number;

      if (side === 'BUY') {
        newQty = (currentQty as number) + filledQuantity;
        // Weighted average cost basis
        newAvgCost =
          newQty !== 0
            ? ((currentQty as number) * (currentAvgCost as number) + filledQuantity * averageFillPrice) / newQty
            : 0;
      } else {
        newQty = (currentQty as number) - filledQuantity;
        newAvgCost = currentAvgCost as number; // avg cost doesn't change on sells
      }

      if (Number.isNaN(newQty) || Number.isNaN(newAvgCost)) {
        throw new NotRetryableError(
          `NaN detected in position calculation: quantity=${newQty}, avgCost=${newAvgCost}`,
        );
      }

      try {
        await this.repository.upsertPosition(
          tenantId,
          pid,
          symbol,
          newQty,
          newAvgCost,
          averageFillPrice,
          currentVersion,
        );

        logger.info('Updated position on order fill', {
          tenantId,
          symbol,
          side,
          newQty,
          newAvgCost,
          version: (currentVersion ?? 0) + 1,
        });
        return; // success
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.name === 'ConditionalCheckFailedException' &&
          attempt < MAX_RETRIES
        ) {
          logger.warn('Version conflict on position update, retrying', {
            tenantId,
            symbol,
            attempt,
          });
          continue;
        }
        throw error;
      }
    }
  }
}
