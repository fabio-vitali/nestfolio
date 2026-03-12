import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const limit = ctx.arguments?.limit ?? 20;

  if (limit < 1 || limit > 100) {
    util.error('limit must be between 1 and 100', 'ValidationError');
  }

  return {
    operation: 'Query',
    index: 'tenantId-index',
    query: {
      expression: 'tenantId = :tenantId',
      expressionValues: util.dynamodb.toMapValues({ ':tenantId': tenantId }),
    },
    filter: {
      expression: '#typename = :typename',
      expressionNames: { '#typename': '__typename' },
      expressionValues: util.dynamodb.toMapValues({ ':typename': 'DecisionReadModel' }),
    },
    limit,
    scanIndexForward: false,
    ...(ctx.arguments?.cursor && { nextToken: ctx.arguments.cursor }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    items: ctx.result.items || [],
    nextCursor: ctx.result.nextToken || null,
  };
}
