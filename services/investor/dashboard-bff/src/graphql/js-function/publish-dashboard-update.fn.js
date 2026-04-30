import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the dashboard-bff
// stream-publisher Lambda after a relevant DDB row mutates. Its sole purpose
// is to drive the @aws_subscribe(mutations: ["publishDashboardUpdate"])
// fan-out to clients subscribed via onDashboardUpdate(tenantId).
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { tenantId, advisoryStatus } = ctx.arguments;
  return {
    tenantId,
    portfolioSummary: null,
    advisoryStatus: advisoryStatus ?? null,
    investorSnapshot: null,
  };
}
