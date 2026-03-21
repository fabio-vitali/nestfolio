import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';
export function request(ctx) {
  return ddb.query({ query: { pk: { eq: `T#${ctx.stash.tenantId}` } } });
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items;
}
