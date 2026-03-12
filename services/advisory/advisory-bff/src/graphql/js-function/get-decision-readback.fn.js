import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const decisionId = ctx.stash.decisionId || ctx.arguments.decisionId;

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: `Decision#${tenantId}#${decisionId}`,
      sk: 'DecisionReadModel',
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
