import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const table = ctx.stash.tableName;
  return {
    operation: 'BatchGetItem',
    tables: {
      [table]: [
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'PortfolioSummary' }),
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'AdvisoryStatus' }),
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'InvestorSnapshot' }),
      ],
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.data[ctx.stash.tableName] || [];
  const byType = {};
  for (const item of items) byType[item.sk] = item;
  return {
    portfolioSummary: byType['PortfolioSummary'] || null,
    advisoryStatus: byType['AdvisoryStatus'] || null,
    investorSnapshot: byType['InvestorSnapshot'] || null,
  };
}
