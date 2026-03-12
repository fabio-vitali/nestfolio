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
      expression: '#status IN (:s1, :s2, :s3, :s4, :s5)',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({
        ':s1': 'PROPOSED',
        ':s2': 'COMPLIANCE_REVIEW',
        ':s3': 'APPROVED',
        ':s4': 'CONFIRMATION_REQUIRED',
        ':s5': 'AWAITING_CONFIRMATION',
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
