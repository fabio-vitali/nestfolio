import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { PortfolioRepository } from '../repositories/portfolio.repository';

type SnapshotPosition = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  currentPrice: number;
};

type SnapshotImportedPayload = {
  tenantId: string;
  portfolioId: string;
  positions: SnapshotPosition[];
  cashBalance?: number;
  currency?: string;
};

export class SnapshotImportedPipe implements Pipe<UnitOfWork<BusEvent<SnapshotImportedPayload>>> {
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<SnapshotImportedPayload>>): Promise<void> {
    const { event } = uow;
    const payload = event.subject;
    const { tenantId, portfolioId, positions, cashBalance, currency } = payload;

    const pid = portfolioId ?? tenantId;

    // Ensure portfolio exists
    await this.repository.getOrCreatePortfolio(tenantId, pid);

    // Reconcile all positions from snapshot
    let totalValue = 0;
    for (const pos of positions) {
      await this.repository.upsertPosition(
        tenantId,
        pid,
        pos.symbol,
        pos.quantity,
        pos.averageCostBasis,
        pos.currentPrice,
      );
      totalValue += pos.quantity * pos.currentPrice;
    }

    // Update cash balance if provided
    if (cashBalance !== undefined) {
      const cur = currency ?? 'USD';
      await this.repository.updateCashBalance(tenantId, pid, cur, cashBalance);
      totalValue += cashBalance;
    }

    // Update portfolio aggregate
    await this.repository.updatePortfolio(tenantId, pid, {
      totalValue,
      positionCount: positions.length,
      cashBalance: cashBalance ?? 0,
    });

    logger.info('Reconciled portfolio from snapshot', {
      tenantId,
      portfolioId: pid,
      positionCount: positions.length,
    });
  }
}
