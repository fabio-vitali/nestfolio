import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { notificationId } = ctx.arguments;
  if (!notificationId) util.error('notificationId is required', 'ValidationError');
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Notification#${notificationId}` }),
    update: {
      expression: 'SET #status = :status, readAt = :now',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':status': 'READ', ':now': now }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
