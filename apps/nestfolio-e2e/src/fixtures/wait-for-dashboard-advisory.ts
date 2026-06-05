import { bffClient, waitForGraphQL } from '@nestfolio/e2e-feature-tests';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

const GET_DASHBOARD = `
  query GetDashboard {
    getDashboard {
      advisoryStatus {
        pendingDecisionsCount
        generatingCount
        failedCount
        oldestGeneratingAt
      }
    }
  }
`;

interface GetDashboardResult {
  getDashboard: {
    advisoryStatus: {
      pendingDecisionsCount: number;
      generatingCount: number;
      failedCount: number;
      oldestGeneratingAt: string | null;
    } | null;
  };
}

/**
 * Block until dashboard-bff has materialised an AdvisoryStatus row satisfying
 * `predicate`. Polls the same getDashboard query the production dashboard fires
 * (Cognito-authed AppSync) — observable user-side behaviour, eliminating the
 * EB→SQS→Lambda race against the component's on-mount query.
 */
export async function waitForDashboardAdvisoryStatus(
  ctx: TestContext,
  tenant: FreshTenant,
  predicate: (s: NonNullable<GetDashboardResult['getDashboard']['advisoryStatus']>) => boolean,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const dashboard = bffClient(ctx, tenant).dashboard;
  await waitForGraphQL<GetDashboardResult>(
    dashboard,
    GET_DASHBOARD,
    {},
    (result) => {
      const s = result.getDashboard?.advisoryStatus;
      return !!s && predicate(s);
    },
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
  );
}
