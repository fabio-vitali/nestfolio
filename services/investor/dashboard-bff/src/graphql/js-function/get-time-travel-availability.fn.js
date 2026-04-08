import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `T#${tenantId}`, sk: 'TimeTravelAvailability' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) {
    return { available: false, oldestDate: null, latestDate: null };
  }
  return ctx.result;
}
