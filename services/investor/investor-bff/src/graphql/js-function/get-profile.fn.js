import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return ddb.get({ key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: 'InvestorProfile' } });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Profile not found', 'NotFound');
  return ctx.result;
}
