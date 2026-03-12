import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  if (!input.targetAmountCents || input.targetAmountCents <= 0) util.error('targetAmountCents must be > 0', 'ValidationError');
  if (!input.timeHorizonMonths || input.timeHorizonMonths < 1 || input.timeHorizonMonths > 600) util.error('timeHorizonMonths must be 1-600', 'ValidationError');
  if (input.targetReturn === undefined || input.targetReturn < 0 || input.targetReturn > 1) util.error('targetReturn must be 0-1', 'ValidationError');
  const goalId = util.autoId();
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._goalResult = { goalId, tenantId, ...input, createdAt: now, updatedAt: now };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Goal#${goalId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'Goal', tenantId, userId, goalId, ...input, createdAt: now, updatedAt: now, timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'Goal', entityId: goalId, action: 'SET', timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._goalResult;
}
