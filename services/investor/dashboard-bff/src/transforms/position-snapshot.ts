import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

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

export const positionSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as PositionPayload;

  const symbol = payload.symbol ?? payload.instrument;
  if (!symbol) return undefined;

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

  return project('PositionSnapshot', {
    tenantId,
    userId,
    region,
    symbol,
    assetClass: payload.assetClass,
    quantity,
    avgCostBasisCents: avgCostCents,
    currentPriceCents,
    marketValueCents,
    weightPercent: payload.weightPercent ?? 0,
    unrealizedPnlCents,
  }, {
    pk: `T#${tenantId}`,
    sk: `PositionSnapshot#${symbol}`,
  });
};
