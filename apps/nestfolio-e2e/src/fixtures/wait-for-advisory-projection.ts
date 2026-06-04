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
 * Block until advisory-bff has materialised at least one DecisionReadModel row
 * for the tenant — i.e., the projection the UI list reads is visible. After
 * WS-3 this includes GENERATING/FAILED cycle-status rows (they pass the
 * getPendingDecisions filter), so the generating scenario can wait on this
 * before navigating, eliminating the EB→SQS→Lambda race against the component's
 * initial query.
 *
 * Polls the same query the production UI fires, against the same Cognito-authed
 * AppSync endpoint — observable user-side behaviour, not a backend-only probe
 * (see feedback_e2e_ui_assertions_only.md).
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
