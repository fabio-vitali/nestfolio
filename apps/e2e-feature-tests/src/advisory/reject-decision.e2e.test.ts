import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withDecision,
  emitDecisionSnapshot,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 7 — investor rejects decision', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withDecision({ trigger: 'REBALANCE' }),
    ]);
    decisionId = result.decisionId as string;
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('rejectDecision transitions status to REJECTED and persists the reason', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // Wait for the decision to materialise before rejecting
    await waitForGraphQL<{ getDecision: { decisionId: string; status: string } | null }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 60_000 },
    );

    // TRIGGER: user rejects the decision.
    // Post-w3 rejectDecision is INTENT-ONLY: it writes a UserRejection row +
    // emits USER_REJECTED, and returns the pre-action readback row (still
    // PENDING, no rejectionReason) — it does NOT write the terminal status. So
    // we assert the mutation ran (echoes the decisionId), NOT that the response
    // is REJECTED. The terminal status arrives only via the producer's
    // higher-versioned snapshot, modelled synthetically below.
    const reject = await bff.advisory.mutate<{
      rejectDecision: { decisionId: string; status: string; rejectedAt: string | null; rejectionReason: string | null };
    }>(
      `mutation RejectDecision($decisionId: ID!, $reason: String!) {
         rejectDecision(decisionId: $decisionId, reason: $reason) {
           decisionId
           status
           rejectedAt
           rejectionReason
         }
       }`,
      { decisionId, reason: 'E2E rejection test' },
    );
    expect(reject.rejectDecision.decisionId).toBe(decisionId);

    // Model the producer (decision-workflow-ctrl) reacting to USER_REJECTED:
    // it increments __version and emits a terminal DECISION_PACKET_UPDATED with
    // status REJECTED + the rejectionReason. The versioned projection (v2 > v1)
    // drives the read-model row to REJECTED.
    await emitDecisionSnapshot(eb, tenant, {
      decisionId,
      trigger: 'REBALANCE',
      status: 'REJECTED',
      version: 2,
      rejectedAt: new Date().toISOString(),
      rejectionReason: 'E2E rejection test',
    });

    // ASSERT: read-back via getDecision confirms REJECTED status + reason
    const readback = await waitForGraphQL<{
      getDecision: { decisionId: string; status: string; rejectionReason: string | null } | null;
    }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status rejectionReason } }`,
      { decisionId },
      (r) => r.getDecision?.status === 'REJECTED',
      { timeoutMs: 60_000 },
    );
    expect(readback.getDecision?.rejectionReason).toBe('E2E rejection test');
  });
});
