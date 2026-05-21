import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withDecision,
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

    // Wait for the decision to materialise before rejecting
    await waitForGraphQL<{ getDecision: { decisionId: string; status: string } | null }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 60_000 },
    );

    // TRIGGER: user rejects the decision
    const reject = await bff.advisory.mutate<{
      rejectDecision: { decisionId: string; status: string; rejectedAt: string; rejectionReason: string };
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
    expect(reject.rejectDecision.status).toBe('REJECTED');
    expect(reject.rejectDecision.rejectionReason).toBe('E2E rejection test');

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
