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
  // Read models are sparse — a freshly-onboarded tenant may have a
  // PortfolioSummary row written by accumulate() that lacks fields the schema
  // declares non-null. Coerce defaults so AppSync doesn't null-coerce the
  // parent object.
  const rawPs = items[0];
  const portfolioSummary = rawPs ? {
    totalValueCents: rawPs.totalValueCents || 0,
    cashBalanceCents: rawPs.cashBalanceCents || 0,
    positionCount: rawPs.positionCount || 0,
    driftPercent: rawPs.driftPercent || 0,
    updatedAt: rawPs.updatedAt || util.time.nowISO8601(),
  } : null;
  const rawAs = items[1];
  const advisoryStatus = rawAs ? {
    pendingDecisionsCount: rawAs.pendingDecisionsCount || 0,
    lastRecommendationAt: rawAs.lastRecommendationAt || null,
    lastDecisionStatus: rawAs.lastDecisionStatus || null,
    updatedAt: rawAs.updatedAt || util.time.nowISO8601(),
  } : null;
  return {
    portfolioSummary,
    advisoryStatus,
    investorSnapshot: items[2] || null,
  };
}
