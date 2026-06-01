import { util } from '@aws-appsync/utils';

// NONE data source: fired IAM-signed from the investor-bff deposit-publisher
// stream Lambda after a WithdrawalRequest P1 row write. Drives the
// @aws_subscribe(mutations: ["publishWithdrawalUpdate"]) fan-out to clients on
// onWithdrawalUpdate(withdrawalId).
//
// withdrawalId MUST be returned in the response — see publish-deposit-update.fn.js.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { withdrawalId, status, amountCents, currency, settledAt, failedAt, reason } =
    ctx.arguments;
  return { withdrawalId, status, amountCents, currency, settledAt, failedAt, reason };
}
