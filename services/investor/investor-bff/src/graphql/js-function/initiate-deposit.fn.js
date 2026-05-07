import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const depositId = input.depositId;
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!depositId) util.error('depositId required', 'ValidationError');
  if (!util.matches('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$', depositId))
    util.error('depositId must be UUID v4', 'ValidationError');
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const now = util.time.nowISO8601();
  ctx.stash._depositResult = { depositId, amountCents, currency, status: 'INITIATED', initiatedAt: now };
  return ddb.put({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${depositId}` },
    item: {
      __typename: 'Deposit', tenantId, userId, region: ctx.stash.region, depositId, amountCents, currency,
      status: 'INITIATED', initiatedAt: now, timestamp: now,
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._depositResult;
}
