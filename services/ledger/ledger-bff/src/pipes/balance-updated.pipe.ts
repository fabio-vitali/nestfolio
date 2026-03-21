import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { PortfolioRepository, type PositionRecord } from '../repositories/portfolio.repository';

type BalancePayload = {
  cashBalanceCents: number;
  deltaCents: number;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export class BalanceUpdatedPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as BalancePayload & Record<string, unknown>;

    const balanceCents = payload.cashBalanceCents ?? 0;
    const deltaCents = payload.deltaCents ?? 0;

    await this.repository.upsertBalance(tenantId, balanceCents, deltaCents);

    // Store snapshot-at for time-travel queries
    if (payload.snapshot) {
      const ttlDays = Number(process.env['SNAPSHOT_HISTORY_TTL_DAYS'] ?? '365');
      const streamType = payload.streamType ?? 'actual';
      await this.repository.saveSnapshotAt(tenantId, streamType, event.timestamp, {
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, ttlDays);
    }

    logger.info('Updated balance projection', {
      tenantId,
      eventType: event.type,
      balanceCents,
    });
  }
}
