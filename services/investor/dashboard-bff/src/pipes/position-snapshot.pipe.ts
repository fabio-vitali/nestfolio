import Highland from 'highland';
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { DashboardRepository } from '../repositories/dashboard.repository';

type PositionPayload = {
  orderId: string;
  symbol?: string;
  instrument?: string;
  filledQuantity: number;
  averageFillPrice: number;
  quantity?: number;
  avgCostBasis?: number;
  currentPrice?: number;
  marketValue?: number;
  weightPercent?: number;
  unrealizedPnl?: number;
  assetClass?: string;
};

export class PositionSnapshotPipe implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>, void> {
  constructor(private readonly repository: DashboardRepository) {}

  feed(source: Highland.Stream<UnitOfWork<BusEvent<Record<string, unknown>>>>): Highland.Stream<void> {
    return source.flatMap((uow) =>
      Highland(
        (async () => {
          const { event } = uow;
          const tenantId = (event.context as Record<string, string>).tenantId;
          const payload = event.subject as PositionPayload;

          const symbol = payload.symbol ?? payload.instrument;
          if (!symbol) {
            logger.info('No symbol in event, skipping position snapshot', {
              eventType: event.type,
            });
            return;
          }

          const quantity = payload.quantity ?? payload.filledQuantity ?? 0;
          const avgCostCents = payload.avgCostBasis
            ? Math.round(payload.avgCostBasis * 100)
            : Math.round((payload.averageFillPrice ?? 0) * 100);
          const currentPriceCents = payload.currentPrice
            ? Math.round(payload.currentPrice * 100)
            : avgCostCents;
          const marketValueCents = payload.marketValue
            ? Math.round(payload.marketValue * 100)
            : quantity * currentPriceCents;
          const unrealizedPnlCents = payload.unrealizedPnl
            ? Math.round(payload.unrealizedPnl * 100)
            : marketValueCents - quantity * avgCostCents;

          await this.repository.upsertPositionSnapshot(tenantId, {
            symbol,
            assetClass: payload.assetClass,
            quantity,
            avgCostBasisCents: avgCostCents,
            currentPriceCents,
            marketValueCents,
            weightPercent: payload.weightPercent ?? 0,
            unrealizedPnlCents,
          });

          logger.info('Updated position snapshot projection', {
            tenantId,
            symbol,
            eventType: event.type,
          });
        })(),
      ),
    );
  }
}
