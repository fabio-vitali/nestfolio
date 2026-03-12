import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const goalId = ctx.arguments.goalId;
  const input = ctx.arguments.input || {};
  if (!goalId) util.error('goalId is required', 'ValidationError');
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;

  const updates = [];
  const values = { ':now': now };

  for (const [key, val] of Object.entries(input)) {
    if (val !== undefined && val !== null) {
      updates.push(`${key} = :${key}`);
      values[`:${key}`] = val;
    }
  }
  updates.push('updatedAt = :now');

  ctx.stash._goalId = goalId;
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Goal#${goalId}` }),
        update: {
          expression: `SET ${updates.join(', ')}`,
          expressionValues: util.dynamodb.toMapValues(values),
        },
        condition: { expression: 'attribute_exists(pk)' },
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'Goal', entityId: goalId, action: 'UPDATE', timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const input = ctx.arguments.input || {};
  return { goalId: ctx.stash._goalId, tenantId: ctx.stash.tenantId, ...input, updatedAt: util.time.nowISO8601(), createdAt: '' };
}
