import { accumulate, project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type OrderFilledPayload = {
  orderId: string;
  brokerOrderId: string;
  filledQuantity: number;
  averageFillPrice: number;
  filledAt: string;
  driftPercent?: number;
};

export const portfolioSummary = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const tenantId = (event.context as Record<string, string>).tenantId;
  const payload = event.subject as OrderFilledPayload & Record<string, unknown>;
  const overrides = { pk: `T#${tenantId}`, sk: 'PortfolioSummary' };

  if (payload.filledQuantity !== undefined && payload.averageFillPrice !== undefined) {
    const tradeValueCents = Math.round(
      payload.filledQuantity * payload.averageFillPrice * 100,
    );
    return accumulate('PortfolioSummary', {
      field: 'totalValueCents',
      increment: tradeValueCents,
      overrides,
    });
  }

  if (payload.driftPercent !== undefined) {
    return project('PortfolioSummary', {
      tenantId,
      driftPercent: payload.driftPercent,
    }, overrides);
  }

  return undefined;
};
