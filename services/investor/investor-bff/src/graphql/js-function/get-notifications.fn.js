import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const limit = ctx.arguments?.limit ?? 20;
  if (limit < 1 || limit > 100) util.error('limit must be between 1 and 100', 'ValidationError');
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({ ':pk': `InvestorProfile#${tenantId}#${userId}`, ':sk': 'Notification#' }),
    },
    limit,
    scanIndexForward: false,
    ...(ctx.arguments?.cursor && { nextToken: ctx.arguments.cursor }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return { items: ctx.result.items || [], nextCursor: ctx.result.nextToken || null };
}
