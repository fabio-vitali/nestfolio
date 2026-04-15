import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const mutationName = ctx.stash.mutationName ?? ctx.info.fieldName;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'FeatureFlag#SYSTEM',
      sk: `FeatureFlag#${mutationName}`,
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result && ctx.result.enabled === false) {
    util.error('This action is temporarily paused', 'SERVICE_TEMPORARILY_UNAVAILABLE');
  }
  return ctx.prev.result;
}
