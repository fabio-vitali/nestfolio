import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  if (!input.score || input.score < 1 || input.score > 10) util.error('score must be 1-10', 'ValidationError');
  if (!input.band || input.band.minEquity === undefined || input.band.maxEquity === undefined) util.error('band required', 'ValidationError');
  if (input.band.minEquity > input.band.maxEquity) util.error('minEquity must be <= maxEquity', 'ValidationError');
  const profileId = util.autoId();
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._riskResult = { profileId, tenantId, score: input.score, band: input.band, assessedAt: now, version: 1 };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `RiskProfile#${profileId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'RiskProfile', tenantId, userId, profileId, score: input.score,
          band: input.band, assessedAt: now, version: 1, timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'RiskProfile', entityId: profileId, action: 'SET', timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._riskResult;
}
