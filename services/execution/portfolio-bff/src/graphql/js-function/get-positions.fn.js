import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.query({
    query: {
      pk: { eq: `Portfolio#${tenantId}#${tenantId}` },
      sk: { beginsWith: 'Position#' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
