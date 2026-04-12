import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const limit = ctx.arguments?.limit ?? 20;
  if (limit < 1 || limit > 100) {
    util.error('limit must be between 1 and 100', 'ValidationError');
  }

  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `History#${tenantId}`,
      }),
    },
    limit,
    scanIndexForward: false,
    ...(ctx.arguments?.nextToken && { nextToken: ctx.arguments.nextToken }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const rawItems = ctx.result.items || [];
  const items = rawItems.map((item) => ({
    eventType: item.eventType,
    payload: JSON.stringify(item.payload ?? {}),
    createdAt: item.createdAt,
    sequenceNo: item.sequenceNo ?? 0,
  }));

  return {
    items,
    nextToken: ctx.result.nextToken || null,
  };
}
