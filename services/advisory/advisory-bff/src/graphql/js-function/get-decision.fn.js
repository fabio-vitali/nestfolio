import { util, runtime } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const { decisionId } = ctx.arguments;

  if (!decisionId || decisionId.length === 0) {
    util.error('decisionId is required', 'ValidationError');
  }
  if (decisionId.length > 256) {
    util.error('decisionId must be 256 characters or less', 'ValidationError');
  }

  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `Decision#${tenantId}#${decisionId}`,
        ':sk': 'DecisionReadModel',
      }),
    },
    limit: 1,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  return items.length > 0 ? items[0] : null;
}
