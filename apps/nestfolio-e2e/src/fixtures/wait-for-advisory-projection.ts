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

interface AdvisoryStatusResult {
  getAdvisoryStatus: {
    tenantId: string;
    inFlightCount: number;
    lastTriggerAt: string | null;
    updatedAt: string;
  } | null;
}

type CombinedResult = GetPendingDecisionsResult & Partial<AdvisoryStatusResult>;

const COMBINED_QUERY = `
  query WaitForAdvisory {
    getPendingDecisions(limit: 5) { items { decisionId status } }
    getAdvisoryStatus { tenantId inFlightCount lastTriggerAt updatedAt }
  }
`;

/**
 * Block until advisory-bff signals that the decision pipeline has advanced
 * far enough for the caller's purpose:
 *
 *  - Default (allowInFlightOnly = false): waits until at least one
 *    `DecisionReadModel` row exists — i.e., the full agent pipeline has
 *    materialised and advisory-bff's projection is visible to the UI list.
 *
 *  - allowInFlightOnly = true: succeeds as soon as EITHER a DecisionReadModel
 *    row exists OR `getAdvisoryStatus.inFlightCount > 0` (i.e., the trigger
 *    has been received and the in-flight banner is already observable). Use
 *    this fast-path for scenarios that want to assert the "generating" UX
 *    state before the agent pipeline completes.
 *
 * Why this exists in Step 8 rather than at the navigation: the dashboard
 * counter (Step 8 baseline) advances ~30 s before advisory-bff's projection
 * catches up, so passing Step 8 is NOT a sufficient barrier for Step 9. Without
 * this wait, the Step 9 navigation can land on `/advisory` and time out on the
 * 15 s POM before the row exists — masquerading as a UI bug when the real
 * issue is upstream pipeline latency.
 *
 * Polls the same queries the production UI fires, against the same
 * Cognito-authed AppSync endpoint — so this is observable user-side behaviour,
 * not a backend-only probe (see `feedback_e2e_ui_assertions_only.md`).
 */
export async function waitForAdvisoryDecisionRow(
  ctx: TestContext,
  tenant: FreshTenant,
  opts?: { timeoutMs?: number; allowInFlightOnly?: boolean },
): Promise<void> {
  const advisory = bffClient(ctx, tenant).advisory;

  if (opts?.allowInFlightOnly) {
    // Use the combined query so we only hit AppSync once per poll cycle.
    await waitForGraphQL<CombinedResult>(
      advisory,
      COMBINED_QUERY,
      {},
      (result) => {
        const hasRow = (result.getPendingDecisions?.items?.length ?? 0) >= 1;
        const inFlight = (result.getAdvisoryStatus?.inFlightCount ?? 0) >= 1;
        return hasRow || inFlight;
      },
      { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
    );
  } else {
    await waitForGraphQL<GetPendingDecisionsResult>(
      advisory,
      GET_PENDING_DECISIONS,
      { limit: 5 },
      (result) => (result.getPendingDecisions?.items?.length ?? 0) >= 1,
      { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
    );
  }
}
