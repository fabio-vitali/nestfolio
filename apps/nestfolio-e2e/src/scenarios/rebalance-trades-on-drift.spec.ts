import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { test, expect } from '../fixtures/test';
import { injectPortfolioUpdated } from '../fixtures/inject-portfolio-updated';
import { waitForLedgerSnapshotRow } from '../fixtures/wait-for-ledger-snapshot';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';

test.describe('steady-state rebalance', () => {
  /**
   * Verify the /advisory page renders BUY+SELL delta trades when the SF
   * runs against a tenant with existing ledger positions (steady state).
   *
   * Scope: this scenario uses synthetic event injection to short-circuit
   * the ledger → adapter chain. The chain itself is covered by the DWC
   * integration tests. The PW scenario exists purely to assert the UI
   * surfaces delta trades + the rebalance badge correctly.
   *
   * Injection strategy:
   *   Step 1 — injectPortfolioUpdated emits PORTFOLIO_UPDATED to the advisory
   *             bus (source `integration-test:decision-workflow-ctrl`), which
   *             the SnapshotProjectorIngress materialises into a LedgerSnapshot
   *             row in the DWC state table.
   *   Step 2 — waitForLedgerSnapshotRow confirms the DDB row exists before the
   *             SF is triggered (eliminates the lookup-race in LookupLedgerSnapshot).
   *   Step 3 — inline PutEvents emits PORTFOLIO_DRIFT_DETECTED to the advisory
   *             bus (source `integration-test:advisory-bff`), which advisory-bff's
   *             Ingress $or filter passes, increments AdvisoryStatus.inFlightCount,
   *             and starts the decision-workflow-ctrl SF.
   *   Step 4 — waitForAdvisoryDecisionRow confirms the DWC has written a
   *             DecisionReadModel row to DDB before navigating, so the /advisory
   *             page reads a completed decision from the initial query (no
   *             subscription delivery race).
   *
   * NOTE: injectAdvisoryBffTriggerEvent is hardcoded to DEPOSIT_DETECTED and
   * does not accept a detailType override, so PORTFOLIO_DRIFT_DETECTED is emitted
   * inline here using the same EB pattern.
   */
  test('UI renders BUY+SELL delta trades + rebalance badge on PORTFOLIO_DRIFT_DETECTED', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    // 1. Seed LedgerSnapshot projection so the SF reads non-empty positions.
    await injectPortfolioUpdated(ctx, tenant, {
      positions: {
        VTI: { quantity: 100, lastFillPrice: 200 }, // 20_000_00c
        BND: { quantity: 50, lastFillPrice: 80 }, //  4_000_00c
      },
      cashBalanceCents: 100_000, // portfolioValue ≈ 2_500_000c
    });
    await waitForLedgerSnapshotRow(ctx, tenant, { timeoutMs: 60_000 });

    // 2. Inject PORTFOLIO_DRIFT_DETECTED to start the SF via advisory-bff.
    //    Source `integration-test:advisory-bff` passes advisory-bff's Ingress
    //    $or filter and triggers AdvisoryStatus.inFlightCount increment + SF start.
    const busArn = await ctx.ssm.busArn('advisory');
    const eb = new EventBridgeClient({ region: ctx.region });
    const eventId = `e2e-${randomUUID()}`;
    const now = new Date().toISOString();

    const result = await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busArn,
            Source: `integration-test:advisory-bff`,
            DetailType: 'PORTFOLIO_DRIFT_DETECTED',
            Detail: JSON.stringify({
              id: eventId,
              type: 'PORTFOLIO_DRIFT_DETECTED',
              timestamp: now,
              subject: {
                tenantId: tenant.tenantId,
              },
              context: {
                tenantId: tenant.tenantId,
                userId: tenant.userId,
                region: ctx.region,
              },
            }),
          },
        ],
      }),
    );

    if ((result.FailedEntryCount ?? 0) > 0) {
      throw new Error(
        `rebalance-trades-on-drift: PutEvents failed — ${result.Entries?.[0]?.ErrorMessage ?? 'unknown'}`,
      );
    }

    // 3. Wait for the DWC to have written a completed DecisionReadModel row
    //    before navigating. This eliminates a subscription delivery race: the
    //    initial getAdvisoryStatus() query fired in ngOnInit always returns a
    //    completed decision once the row exists.
    await waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs: 120_000 });

    // 4. Navigate to /advisory; wait for a decision card.
    await onboardedPage.goto('/advisory');
    const decisionCard = onboardedPage.locator('[data-testid^="decision-"]').first();
    await expect(decisionCard).toBeVisible({ timeout: 30_000 });

    // 5. Assert BUY+SELL trade rows + rebalance badge.
    const tradeRows = onboardedPage.locator('[data-testid="proposed-trade"]');
    await expect(tradeRows).not.toHaveCount(0);

    // .side-tag is confirmed in trades-table.component.ts (line 25) — the <span>
    // inside each proposed-trade row carries this class and renders trade.side text.
    const sides = await tradeRows.locator('.side-tag').allInnerTexts();
    expect(sides.some((s) => s.trim() === 'BUY')).toBe(true);
    expect(sides.some((s) => s.trim() === 'SELL')).toBe(true);

    await expect(onboardedPage.locator('[data-testid="rebalance-badge"]')).toBeVisible();
  });
});
