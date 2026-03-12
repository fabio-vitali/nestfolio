import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (mode !== 'CONSERVATIVE' && mode !== 'BALANCED' && mode !== 'AGGRESSIVE') {
    util.error('mode must be CONSERVATIVE, BALANCED, or AGGRESSIVE', 'ValidationError');
  }
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._modeResult = { mode, selectedAt: now };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `OperatingMode#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'OperatingModeRecord', tenantId, userId, mode, selectedAt: now, timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'OperatingMode', action: 'SELECT', timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
        update: {
          expression: 'SET operatingMode = :mode, updatedAt = :now',
          expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now }),
        },
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._modeResult;
}
