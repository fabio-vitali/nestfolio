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
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#status': 'status', '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({
        ':revoked': 'REVOKED',
        ':active': 'ACTIVE',
        ':now': now,
        ':zero': 0,
        ':one': 1,
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
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Mandate is not active (already revoked or never issued)', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
