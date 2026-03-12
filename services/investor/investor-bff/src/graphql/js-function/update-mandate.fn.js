import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  if (input.monthlyTurnoverCapPercent < 0 || input.monthlyTurnoverCapPercent > 100) util.error('monthlyTurnoverCapPercent 0-100', 'ValidationError');
  if (input.maxSingleTradePercent < 0 || input.maxSingleTradePercent > 100) util.error('maxSingleTradePercent 0-100', 'ValidationError');
  if (input.coolDownDays < 0 || input.coolDownDays > 365) util.error('coolDownDays 0-365', 'ValidationError');
  const mandateId = util.autoId();
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._mandateResult = { mandateId, tenantId, ...input, effectiveDate: now, revokedAt: null, version: 1 };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Mandate#${mandateId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'Mandate', tenantId, userId, mandateId, ...input,
          effectiveDate: now, revokedAt: null, version: 1, timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'Mandate', entityId: mandateId, action: 'UPDATE', timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._mandateResult;
}
