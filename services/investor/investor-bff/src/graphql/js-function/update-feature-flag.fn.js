import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { name, enabled, reason } = ctx.arguments;
  const now = util.time.nowISO8601();
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'FeatureFlag#SYSTEM',
      sk: `FeatureFlag#${name}`,
    }),
    attributeValues: util.dynamodb.toMapValues({
      __typename: 'FeatureFlag',
      name,
      enabled,
      reason: reason ?? null,
      updatedAt: now,
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    name: ctx.result.name,
    enabled: ctx.result.enabled,
    reason: ctx.result.reason,
  };
}
