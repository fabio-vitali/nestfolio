import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({ ':pk': `InvestorProfile#${tenantId}#${userId}`, ':sk': 'Notification#' }),
    },
    filter: {
      expression: '#status <> :read',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':read': 'READ' }),
    },
    select: 'COUNT',
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.scannedCount || 0;
}
