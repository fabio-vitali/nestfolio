import { util } from '@aws-appsync/utils';

/**
 * revokeMandate — single UpdateItem on the MandateStatus sibling row
 * (sk='MandateStatus'), NOT on the composite InvestorProfile row.
 *
 * Targeting MandateStatus avoids spurious INVESTOR_PROFILE_UPDATED CDC
 * emissions for what is semantically a mandate-lifecycle event. The
 * MandateStatus row's modify CDC instead emits MANDATE_REVOKED.
 *
 * Precondition `status = ACCEPTED` prevents double-revoke (idempotent
 * surface — second call surfaces as InvalidState).
 */
export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'MandateStatus' }),
    update: {
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
      expressionNames: { '#status': 'status', '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({ ':revoked': 'REVOKED', ':now': now }),
    },
    condition: {
      expression: 'attribute_exists(pk) AND #status = :active',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':active': 'ACCEPTED' }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Mandate is not active or already revoked', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return {
    status: ctx.result.status,
    acceptedAt: ctx.result.acceptedAt,
    revokedAt: ctx.result.revokedAt,
  };
}
