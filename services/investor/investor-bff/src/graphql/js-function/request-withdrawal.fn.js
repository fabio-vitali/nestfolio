import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const withdrawalId = util.autoId();
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  ctx.stash._withdrawalResult = { withdrawalId, amountCents, currency, status: 'REQUESTED', requestedAt: now };
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table: ctx.stash.tableName,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'CashBalance' }),
        update: {
          expression: 'SET cashBalanceCents = cashBalanceCents - :amount',
          expressionValues: util.dynamodb.toMapValues({ ':amount': amountCents }),
        },
        condition: { expression: 'attribute_exists(pk) AND cashBalanceCents >= :amount' },
      },
      {
        table: ctx.stash.tableName,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Withdrawal#${withdrawalId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'Withdrawal', tenantId, userId, region: ctx.stash.region, withdrawalId, amountCents, currency,
          status: 'REQUESTED', requestedAt: now, timestamp: now,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Insufficient funds', 'InsufficientFundsError');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.stash._withdrawalResult;
}
