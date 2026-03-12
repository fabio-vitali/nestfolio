import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const now = util.time.nowISO8601();
  return ddb.put({
    key: { pk: `Portfolio#${tenantId}#${tenantId}`, sk: 'PortfolioSummary' },
    attributeValues: {
      __typename: 'Portfolio',
      portfolioId: tenantId,
      tenantId,
      totalValue: 0,
      cashBalance: 0,
      positionCount: 0,
      updatedAt: now,
      timestamp: now,
    },
    condition: { pk: { attributeExists: false } },
  });
}

export function response(ctx) {
  if (ctx.error && ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
    // Race condition — another request created it, return defaults
    const { tenantId } = ctx.stash;
    return {
      portfolioId: tenantId,
      tenantId,
      totalValue: 0,
      cashBalance: 0,
      positionCount: 0,
      updatedAt: util.time.nowISO8601(),
    };
  }
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
