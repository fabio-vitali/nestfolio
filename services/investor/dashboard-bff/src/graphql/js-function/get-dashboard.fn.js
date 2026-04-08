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
  return {
    portfolioSummary: items[0] || null,
    advisoryStatus: items[1] || null,
    investorSnapshot: items[2] || null,
  };
}
