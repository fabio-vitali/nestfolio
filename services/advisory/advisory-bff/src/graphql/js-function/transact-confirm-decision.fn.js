import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { decisionId } = ctx.arguments;

  if (!decisionId || decisionId.length === 0) {
    util.error('decisionId is required', 'ValidationError');
  }
  if (decisionId.length > 256) {
    util.error('decisionId must be 256 characters or less', 'ValidationError');
  }

  const now = util.time.nowISO8601();
  const pk = `Decision#${tenantId}#${decisionId}`;

  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'DecisionReadModel' }),
        update: {
          expression: 'SET #status = :status, confirmedAt = :now, confirmedBy = :userId, version = version + :one',
          expressionNames: { '#status': 'status' },
          expressionValues: util.dynamodb.toMapValues({
            ':status': 'CONFIRMED',
            ':now': now,
            ':userId': userId,
            ':one': 1,
          }),
        },
      },
      {
        table: ctx.stash.tableName,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `UserConfirmation#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'UserConfirmation',
          tenantId,
          decisionId,
          confirmedAt: now,
          confirmedBy: userId,
          timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.decisionId = ctx.arguments.decisionId;
  return ctx.prev.result;
}
