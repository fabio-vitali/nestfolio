import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the dashboard-bff
// stream-publisher Lambda after a relevant DDB Activity row insert. Its sole
// purpose is to drive the @aws_subscribe(mutations: ["publishActivityUpdate"])
// fan-out to clients subscribed via onActivityUpdate(tenantId).
//
// tenantId MUST be returned in the response — AppSync's @aws_subscribe filter
// matches the subscription's tenantId arg against fields in the RESPONSE, not
// the input args. Forgetting this drops every broadcast silently.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { tenantId, activity } = ctx.arguments;
  return {
    tenantId,
    activity,
  };
}
