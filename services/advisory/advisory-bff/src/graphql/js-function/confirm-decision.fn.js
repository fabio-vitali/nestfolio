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

  // get-decision-readback pre-step has placed the existing DecisionReadModel
  // in ctx.prev.result. Lift taskToken (stamped by SF on
  // USER_CONFIRMATION_REQUESTED) onto the UserConfirmation row so CDC
  // re-emits USER_CONFIRMED with subject.taskToken. Without this, the SF
  // execution waiting at WaitForUserResponse cannot resume.
  const taskToken = ctx.prev?.result?.taskToken;

  const now = util.time.nowISO8601();
  const pk = `Decision#${tenantId}#${decisionId}`;

  const userConfirmationAttrs = {
    __typename: 'UserConfirmation',
    tenantId,
    region,
    decisionId,
    confirmedAt: now,
    confirmedBy: userId,
    timestamp: now,
  };
  if (taskToken) {
    userConfirmationAttrs.taskToken = taskToken;
  }

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
        attributeValues: util.dynamodb.toMapValues(userConfirmationAttrs),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  ctx.stash.decisionId = ctx.arguments.decisionId;
  return ctx.prev.result;
}
