import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId, region } = ctx.stash;
  const { decisionId } = ctx.arguments;

  if (!decisionId || decisionId.length === 0) {
    util.error('decisionId is required', 'ValidationError');
  }
  if (decisionId.length > 256) {
    util.error('decisionId must be 256 characters or less', 'ValidationError');
  }

  const now = util.time.nowISO8601();
  ctx.stash._viewedAt = now;

  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: `Decision#${tenantId}#${decisionId}`,
      sk: `UserInteraction#${util.autoId()}`,
    }),
    attributeValues: util.dynamodb.toMapValues({
      __typename: 'UserInteraction',
      tenantId,
      region,
      decisionId,
      viewedAt: now,
      viewedBy: userId,
      timestamp: now,
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    decisionId: ctx.arguments.decisionId,
    viewedAt: ctx.result.viewedAt || ctx.stash._viewedAt,
  };
}
