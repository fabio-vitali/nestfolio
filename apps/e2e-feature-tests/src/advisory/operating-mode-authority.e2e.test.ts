import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

/**
 * Verifies that operating mode affects L1/L2 authority resolution.
 * A 6% trade should be:
 *   - L2 in CONSERVATIVE (max 5%)
 *   - L1 in BALANCED (max 10%)
 *   - L1 in AGGRESSIVE (max 20%)
 */
describe.each([
  { mode: 'CONSERVATIVE' as const, tradePercent: 6, expectedNeedsConfirmation: true },
  { mode: 'BALANCED' as const, tradePercent: 6, expectedNeedsConfirmation: false },
  { mode: 'AGGRESSIVE' as const, tradePercent: 6, expectedNeedsConfirmation: false },
])('operating mode $mode — $tradePercent% trade', ({ mode, tradePercent, expectedNeedsConfirmation }) => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const capitalAmount = 100_000;
    const tradeAmount = Math.round((capitalAmount * tradePercent) / 100);
    const result = await applyFixtures(ctx, tenant, [
      onboarded({ operatingMode: mode, capitalAmount }),
      funded({ cashBalanceCents: capitalAmount }),
      withDecision({
        trigger: 'REBALANCE',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: tradeAmount }],
      }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it(`decision is ${expectedNeedsConfirmation ? 'L2 (confirmation required)' : 'L1 (autonomous)'}`, async () => {
    const bff = bffClient(ctx, tenant);

    const decision = await waitForGraphQL<{
      getDecision: { decisionId: string; status: string; confirmationRequired: boolean } | null;
    }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) {
        getDecision(decisionId: $decisionId) { decisionId status confirmationRequired }
      }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 120_000 },
    );

    expect(decision.getDecision?.confirmationRequired).toBe(expectedNeedsConfirmation);
  });
});
