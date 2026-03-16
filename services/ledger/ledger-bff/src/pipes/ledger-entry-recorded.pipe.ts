import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { PortfolioRepository, type PositionRecord } from '../repositories/portfolio.repository';

type LedgerEntryPayload = {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sequenceNo: number;
  streamType?: string;
  cashBalanceCents?: number;
  positions?: Record<string, PositionRecord>;
};

const CHECKPOINT_INTERVAL = 100; // Save checkpoint every N entries

export class LedgerEntryRecordedPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as LedgerEntryPayload & Record<string, unknown>;

    // Append to history
    await this.repository.appendHistory(tenantId, {
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: payload.payload ?? {},
      timestamp: payload.timestamp,
      sequenceNo: payload.sequenceNo,
      streamType: payload.streamType,
    });

    // If simulated stream, also update simulation projections
    if (payload.streamType === 'simulated') {
      const cashBalanceCents = payload.cashBalanceCents ?? 0;
      const positions = payload.positions ?? {};

      await this.repository.upsertSimulation(tenantId, {
        cashBalanceCents,
        positions,
      });

      for (const [symbol, position] of Object.entries(positions)) {
        await this.repository.upsertSimulationPosition(tenantId, symbol, {
          symbol,
          quantity: position.quantity ?? 0,
          averageCostBasis: position.averageCostBasis ?? 0,
          totalCostBasis: position.totalCostBasis ?? 0,
          lastFillPrice: position.lastFillPrice ?? 0,
        });
      }
    }

    // Conditionally save checkpoint (every N entries)
    if (payload.sequenceNo > 0 && payload.sequenceNo % CHECKPOINT_INTERVAL === 0) {
      const date = payload.timestamp.slice(0, 10);
      try {
        await this.repository.saveCheckpoint(tenantId, date, {
          cashBalanceCents: payload.cashBalanceCents ?? 0,
          positions: payload.positions ?? {},
        });
        logger.info('Saved checkpoint', { tenantId, date, sequenceNo: payload.sequenceNo });
      } catch (error) {
        // ConditionalCheckFailed means checkpoint already exists for this date — safe to ignore
        if ((error as Record<string, string>).name === 'ConditionalCheckFailedException') {
          logger.info('Checkpoint already exists, skipping', { tenantId, date });
        } else {
          throw error;
        }
      }
    }

    logger.info('Recorded ledger entry', {
      tenantId,
      eventType: payload.eventType,
      sequenceNo: payload.sequenceNo,
      streamType: payload.streamType ?? 'actual',
    });
  }
}
