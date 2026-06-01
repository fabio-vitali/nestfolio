import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the investor-bff
// deposit-publisher stream Lambda after a Deposit P1 row write. Its sole purpose
// is to drive the @aws_subscribe(mutations: ["publishDepositUpdate"]) fan-out to
// clients subscribed via onDepositUpdate(depositId).
//
// depositId MUST be returned in the response — AppSync's @aws_subscribe filter
// matches the subscription's depositId arg against fields in the RESPONSE, not
// the input args. Forgetting this drops every broadcast silently.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { depositId, status, amountCents, currency, detectedAt, settledAt, failedAt, reason } =
    ctx.arguments;
  return { depositId, status, amountCents, currency, detectedAt, settledAt, failedAt, reason };
}
