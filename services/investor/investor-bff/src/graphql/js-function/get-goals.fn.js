import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return ddb.query({ query: { pk: { eq: `InvestorProfile#${tenantId}#${userId}` }, sk: { beginsWith: 'Goal#' } } });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
