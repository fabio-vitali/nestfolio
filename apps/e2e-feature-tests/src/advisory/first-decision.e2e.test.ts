import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import type { DecisionHistoryResponse } from '../helpers/graphql-types';

describe('scenario 11 — investor sees first advisory decision after onboarding', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('MANDATE_CREATED triggers the advisory cycle, decision surfaces in getDecisionHistory', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER: synthetic MANDATE_CREATED on advisory bus (advisory-ctrl subscribes to AdvisoryBus)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        mandateId: `e2e-mandate-${Date.now()}`,
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 1,
        rebalanceCadence: 'MONTHLY',
      },
    });

    // ASSERT: advisory-bff eventually surfaces a decision via getDecisionHistory
    // (getDecisionHistory has no status filter — catches PENDING and beyond)
    const history = await waitForGraphQL<DecisionHistoryResponse>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId status trigger } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.length > 0,
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    expect(history.getDecisionHistory.items.length).toBeGreaterThan(0);
    expect(history.getDecisionHistory.items[0]).toMatchObject({
      decisionId: expect.any(String),
      trigger: expect.any(String),
      status: expect.any(String),
    });
  });
});
