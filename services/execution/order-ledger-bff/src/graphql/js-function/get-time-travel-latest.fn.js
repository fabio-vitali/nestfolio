import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND sk BETWEEN :start AND :end',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `Portfolio#${tenantId}#actual`,
        ':start': 'Checkpoint#',
        ':end': 'Checkpoint#9999-12-31',
      }),
    },
    scanIndexForward: false,
    limit: 1,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.items || [];
  const earliestDate = ctx.stash.earliestDate;

  if (!earliestDate || items.length === 0) {
    return { available: false, oldestDate: null, latestDate: null };
  }

  const latestDate = items[0].sk.replace('Checkpoint#', '');
  return { available: true, oldestDate: earliestDate, latestDate };
}
