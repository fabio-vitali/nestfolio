import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :prefix)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': 'FeatureFlag#SYSTEM',
        ':prefix': 'FeatureFlag#',
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result?.items ?? [];
  return items.map(item => ({
    name: item.name,
    enabled: item.enabled,
    reason: item.reason ?? null,
  }));
}
