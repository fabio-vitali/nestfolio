import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const table = ctx.stash.tableName;
  const pk = `T#${tenantId}`;
  return {
    operation: 'TransactGetItems',
    transactItems: [
      { table, key: util.dynamodb.toMapValues({ pk, sk: 'PortfolioSummary' }) },
      { table, key: util.dynamodb.toMapValues({ pk, sk: 'AdvisoryStatus' }) },
      { table, key: util.dynamodb.toMapValues({ pk, sk: 'InvestorSnapshot' }) },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  const rawPs = items[0];
  const portfolioSummary = (rawPs && rawPs.sk)
    ? {
        totalValueCents: rawPs.totalValueCents,
        cashBalanceCents: rawPs.cashBalanceCents,
        positionCount: rawPs.positionCount,
        updatedAt: rawPs.updatedAt,
      }
    : null;
  const rawAs = items[1];
  const advisoryStatus = rawAs ? {
    pendingDecisionsCount: rawAs.pendingDecisionsCount || 0,
    generatingCount: rawAs.generatingCount || 0,
    failedCount: rawAs.failedCount || 0,
    oldestGeneratingAt: rawAs.oldestGeneratingAt ?? null,
    updatedAt: rawAs.updatedAt || util.time.nowISO8601(),
  } : null;
  return {
    portfolioSummary,
    advisoryStatus,
    investorSnapshot: items[2] || null,
  };
}
