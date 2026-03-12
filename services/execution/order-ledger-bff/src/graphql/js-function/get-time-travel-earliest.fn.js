import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :sk)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `Portfolio#${tenantId}#actual`,
        ':sk': 'Checkpoint#',
      }),
    },
    scanIndexForward: true,
    limit: 1,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  if (items.length === 0) {
    ctx.stash.earliestDate = null;
  } else {
    ctx.stash.earliestDate = items[0].sk.replace('Checkpoint#', '');
  }
  return ctx.prev.result;
}
