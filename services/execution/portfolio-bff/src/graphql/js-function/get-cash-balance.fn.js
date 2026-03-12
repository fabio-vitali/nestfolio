import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `Portfolio#${tenantId}#${tenantId}`, sk: 'CashBalance#USD' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) {
    return { currency: 'USD', amount: 0, updatedAt: util.time.nowISO8601() };
  }
  return ctx.result;
}
