import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  // First step: get latest portfolio state
  // We use a Query to fetch both Latest and all Position# records in one call
  return ddb.query({
    query: {
      pk: { eq: `Portfolio#${tenantId}` },
      sk: { beginsWith: '' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  const items = ctx.result.items || [];
  const latest = items.find((i) => i.sk === 'Latest');
  const positions = items
    .filter((i) => i.sk && i.sk.startsWith('Position#'))
    .map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity ?? 0,
      averageCostBasis: p.averageCostBasis ?? 0,
      totalCostBasis: p.totalCostBasis ?? 0,
      lastFillPrice: p.lastFillPrice ?? 0,
    }));

  const cashBalanceCents = latest ? (latest.cashBalanceCents ?? 0) : 0;
  let totalValueCents = cashBalanceCents;
  for (const pos of positions) {
    totalValueCents += Math.round(pos.quantity * pos.lastFillPrice * 100);
  }

  return {
    cashBalanceCents,
    positions,
    totalValueCents,
  };
}
