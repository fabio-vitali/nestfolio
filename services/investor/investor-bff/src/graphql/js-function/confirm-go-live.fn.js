import { util } from '@aws-appsync/utils';

// Deterministic go-live commit. P1 scope: flip executionMode simulation→live atomically
// with a write-once ExecutionModeChange audit row (CDC → EXECUTION_MODE_CHANGED → broker-ctrl).
// A later phase adds a third transactItem re-affirming the Mandate row.
export function request(ctx) {
  const { tenantId, userId, tableName } = ctx.stash;
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const changeId = `${tenantId}#${userId}#${now}`;

  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: tableName,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `ExecutionModeChange#${changeId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'ExecutionModeChange',
          tenantId, userId,
          changeId, fromMode: 'simulation', toMode: 'live',
          changedAt: now, timestamp: now,
        }),
        condition: { expression: 'attribute_not_exists(pk)' },
      },
      {
        table: tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
        update: {
          expression:
            'SET executionMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
          expressionNames: { '#ts': 'timestamp', '#v': '__version' },
          expressionValues: util.dynamodb.toMapValues({ ':mode': 'live', ':now': now, ':zero': 0, ':one': 1, ':simulation': 'simulation' }),
        },
        condition: { expression: 'attribute_exists(pk) AND executionMode = :simulation' },
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:TransactionCanceledException') {
      util.error('Cannot confirm go-live (profile missing or already live)', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // TransactWriteItems returns no attributes; get-profile.fn.js readback (extraSteps) returns the profile.
  return ctx.result;
}
