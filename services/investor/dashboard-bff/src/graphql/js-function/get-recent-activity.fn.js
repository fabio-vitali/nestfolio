import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const limit = ctx.arguments?.limit ?? 20;

  if (limit < 1 || limit > 100) {
    util.error('limit must be between 1 and 100', 'ValidationError');
  }

  return ddb.query({
    query: {
      pk: { eq: `Dashboard#${tenantId}` },
      sk: { beginsWith: 'Activity#' },
    },
    limit,
    scanIndexForward: false,
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
