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

describe('scenario 8 — investor views decision explanation', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);
    decisionId = result.decisionId as string;
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('recordExplanationView returns a ViewReceipt with viewedAt set', async () => {
    const bff = bffClient(ctx, tenant);

    // Wait for the decision to materialise before recording the view
    await waitForGraphQL<{ getDecision: { decisionId: string; status: string } | null }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 60_000 },
    );

    // TRIGGER: user views the decision explanation
    const receipt = await bff.advisory.mutate<{
      recordExplanationView: { decisionId: string; viewedAt: string };
    }>(
      `mutation RecordView($decisionId: ID!) {
         recordExplanationView(decisionId: $decisionId) {
           decisionId
           viewedAt
         }
       }`,
      { decisionId },
    );

    // ASSERT: returned ViewReceipt contains the correct decisionId and a valid timestamp
    expect(receipt.recordExplanationView.decisionId).toBe(decisionId);
    expect(receipt.recordExplanationView.viewedAt).toBeTruthy();
    expect(new Date(receipt.recordExplanationView.viewedAt).toString()).not.toBe('Invalid Date');
  });
});
