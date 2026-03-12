import { util, runtime } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `Portfolio#${tenantId}#${tenantId}`, sk: 'PortfolioSummary' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result) {
    return runtime.earlyReturn(ctx.result);
  }
  return null;
}
