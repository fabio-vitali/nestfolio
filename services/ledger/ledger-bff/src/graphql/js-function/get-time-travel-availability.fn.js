import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `Checkpoint#${tenantId}`,
      }),
    },
    scanIndexForward: true,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];

  if (items.length === 0) {
    return { earliestDate: null, latestDate: null };
  }

  const earliestDate = items[0].sk;
  const latestDate = items[items.length - 1].sk;

  return { earliestDate, latestDate };
}
