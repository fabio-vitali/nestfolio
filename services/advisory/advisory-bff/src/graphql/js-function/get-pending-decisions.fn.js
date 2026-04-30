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
      expression: 'tenantId = :tenantId AND #typename = :typename',
      expressionNames: { '#typename': '__typename' },
      expressionValues: util.dynamodb.toMapValues({ ':tenantId': tenantId, ':typename': 'DecisionReadModel' }),
    },
    filter: {
      expression: '#status IN (:s1, :s2, :s3, :s4, :s5, :s6, :s7)',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({
        ':s1': 'PENDING',
        ':s2': 'DRAFT',
        ':s3': 'PROPOSED',
        ':s4': 'COMPLIANCE_REVIEW',
        ':s5': 'APPROVED',
        ':s6': 'CONFIRMATION_REQUIRED',
        ':s7': 'AWAITING_CONFIRMATION',
      }),
    },
    limit,
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
