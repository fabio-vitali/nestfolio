import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const depositId = util.autoId();
  const now = util.time.nowISO8601();
  ctx.stash._depositResult = { depositId, amountCents, currency, status: 'INITIATED', initiatedAt: now };
  return ddb.put({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${depositId}` },
    attributeValues: {
      __typename: 'Deposit', tenantId, userId, depositId, amountCents, currency,
      status: 'INITIATED', initiatedAt: now, timestamp: now,
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._depositResult;
}
