import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const input = ctx.arguments.input;
  const { depositId, tenantId, userId, status, amountCents, currency, occurredAt, reason } = input;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: `Deposit#${depositId}`,
    }),
    condition: {
      expression: 'attribute_exists(pk)',
    },
    update: {
      expression:
        'SET #status = :status, amountCents = :amountCents, currency = :currency, occurredAt = :occurredAt, #reason = :reason',
      expressionNames: {
        '#status': 'status',
        '#reason': 'reason',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':status': status,
        ':amountCents': amountCents,
        ':currency': currency,
        ':occurredAt': occurredAt,
        ':reason': reason ?? null,
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    depositId: ctx.result.depositId,
    tenantId: ctx.result.tenantId,
    status: ctx.result.status,
    amountCents: ctx.result.amountCents,
    currency: ctx.result.currency,
    occurredAt: ctx.result.occurredAt,
    reason: ctx.result.reason ?? null,
  };
}
