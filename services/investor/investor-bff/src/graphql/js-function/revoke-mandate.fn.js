import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'Mandate',
    }),
    update: {
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
      expressionNames: { '#status': 'status', '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({
        ':revoked': 'REVOKED',
        ':active': 'ACTIVE',
        ':now': now,
      }),
    },
    condition: {
      expression: 'attribute_exists(pk) AND #status = :active',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':active': 'ACTIVE' }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
