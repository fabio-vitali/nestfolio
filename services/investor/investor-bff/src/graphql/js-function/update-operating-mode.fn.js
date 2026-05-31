import { util } from '@aws-appsync/utils';

const VALID_MODES = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (!VALID_MODES.includes(mode)) {
    util.error(`Invalid operatingMode: ${mode}`, 'ValidationError');
  }
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'InvestorProfile',
    }),
    update: {
      expression:
        'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now, ':zero': 0, ':one': 1 }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
