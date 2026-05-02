import { bffClient, waitForGraphQL } from '@nestfolio/e2e-feature-tests';
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

const GET_PENDING_DECISIONS = `
  query GetPendingDecisions($limit: Int) {
    getPendingDecisions(limit: $limit) {
      items {
        decisionId
        status
      }
    }
  }
`;

interface GetPendingDecisionsResult {
  getPendingDecisions: {
    items: Array<{ decisionId: string; status: string }>;
  };
}

/**
 * Block until advisory-bff's `getPendingDecisions` returns at least one item
 * for the test tenant — i.e., the agent pipeline has materialised the
 * `DecisionReadModel` row that the UI list depends on.
 *
 * Why this exists in Step 8 rather than at the navigation: the dashboard
 * counter (Step 8 baseline) advances ~30 s before advisory-bff's projection
 * catches up, so passing Step 8 is NOT a sufficient barrier for Step 9. Without
 * this wait, the Step 9 navigation can land on `/advisory` and time out on the
 * 15 s POM before the row exists — masquerading as a UI bug when the real
 * issue is upstream pipeline latency.
 *
 * Polls the same `getPendingDecisions` query the production UI fires, against
 * the same Cognito-authed AppSync endpoint — so this is observable user-side
 * behaviour, not a backend-only probe (see `feedback_e2e_ui_assertions_only.md`).
 *
 * The proper UX fix (loading state on `/advisory` when `pendingDecisionsCount > 0`
 * and the list is empty) is filed in PARKING LOT — until then this is the
 * pragmatic gate-unblocker.
 */
export async function waitForAdvisoryDecisionRow(
  ctx: TestContext,
  tenant: FreshTenant,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const advisory = bffClient(ctx, tenant).advisory;
  await waitForGraphQL<GetPendingDecisionsResult>(
    advisory,
    GET_PENDING_DECISIONS,
    { limit: 5 },
    (result) => (result.getPendingDecisions?.items?.length ?? 0) >= 1,
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
  );
}
