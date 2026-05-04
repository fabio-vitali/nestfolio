import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  if (input.monthlyTurnoverCapPercent !== undefined && input.monthlyTurnoverCapPercent !== null) {
    if (input.monthlyTurnoverCapPercent < 0 || input.monthlyTurnoverCapPercent > 100) {
      util.error('monthlyTurnoverCapPercent 0-100', 'ValidationError');
    }
  }
  if (input.maxSingleTradePercent !== undefined && input.maxSingleTradePercent !== null) {
    if (input.maxSingleTradePercent < 0 || input.maxSingleTradePercent > 100) {
      util.error('maxSingleTradePercent 0-100', 'ValidationError');
    }
  }
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;

  const updates = [];
  const names = {};
  const values = { ':now': now };

  for (const [key, val] of Object.entries(input)) {
    if (val !== undefined && val !== null) {
      updates.push(`mandate.#${key} = :${key}`);
      names[`#${key}`] = key;
      values[`:${key}`] = val;
    }
  }
  updates.push('updatedAt = :now');

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
    update: {
      expression: `SET ${updates.join(', ')}`,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.mandate;
}
