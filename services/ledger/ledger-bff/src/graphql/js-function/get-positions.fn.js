import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const symbol = ctx.arguments?.symbol;

  if (symbol) {
    // Query specific position
    return ddb.get({
      key: { pk: `Portfolio#${tenantId}`, sk: `Position#${symbol}` },
    });
  }

  // Query all positions
  return ddb.query({
    query: {
      pk: { eq: `Portfolio#${tenantId}` },
      sk: { beginsWith: 'Position#' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);

  // Single position lookup
  if (ctx.arguments?.symbol) {
    if (!ctx.result) return [];
    return [{
      symbol: ctx.result.symbol,
      quantity: ctx.result.quantity ?? 0,
      averageCostBasis: ctx.result.averageCostBasis ?? 0,
      totalCostBasis: ctx.result.totalCostBasis ?? 0,
      lastFillPrice: ctx.result.lastFillPrice ?? 0,
    }];
  }

  // All positions
  const items = ctx.result.items || [];
  return items.map((p) => ({
    symbol: p.symbol,
    quantity: p.quantity ?? 0,
    averageCostBasis: p.averageCostBasis ?? 0,
    totalCostBasis: p.totalCostBasis ?? 0,
    lastFillPrice: p.lastFillPrice ?? 0,
  }));
}
