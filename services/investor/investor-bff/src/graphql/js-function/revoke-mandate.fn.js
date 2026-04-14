import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const mandateId = 'latest';
  ctx.stash._revokeResult = { mandateId, tenantId, level: 'DISCRETIONARY', monthlyTurnoverCapPercent: 0, maxSingleTradePercent: 0, coolDownDays: 0, rebalanceCadence: 'MONTHLY', effectiveDate: now, revokedAt: now, version: 0 };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `MandateRevocation#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'MandateRevocation', tenantId, userId, revokedAt: now, timestamp: now,
        }),
      },
      {
        table: ctx.stash.tableName, operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${now}#${util.autoId()}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent', tenantId, userId, entityType: 'Mandate', action: 'REVOKE', timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._revokeResult;
}
