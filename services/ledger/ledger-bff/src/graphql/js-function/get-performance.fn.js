import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  // Query all portfolio items (Latest + positions) in one call
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
  const positions = items.filter((i) => i.sk && i.sk.startsWith('Position#'));

  const cashBalanceCents = latest ? (latest.cashBalanceCents ?? 0) : 0;

  let investedValueCents = 0;
  let marketValueCents = 0;
  for (const pos of positions) {
    const qty = pos.quantity ?? 0;
    investedValueCents += Math.round((pos.totalCostBasis ?? 0) * 100);
    marketValueCents += Math.round(qty * (pos.lastFillPrice ?? 0) * 100);
  }

  const totalValueCents = cashBalanceCents + marketValueCents;
  const returnPercent = investedValueCents > 0
    ? Math.round(((marketValueCents - investedValueCents) / investedValueCents) * 10000) / 100
    : null;

  return {
    totalValueCents,
    cashBalanceCents,
    investedValueCents,
    returnPercent,
  };
}
