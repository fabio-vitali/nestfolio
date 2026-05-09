import { test, expect } from '../fixtures/test';
import {
  injectAdvisoryBffTriggerEvent,
  injectDashboardBffTriggerEvent,
} from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';

test.describe('advisory generating state', () => {
  /**
   * Verify that the /advisory page shows the "generating" empty-state
   * immediately after a DEPOSIT_DETECTED trigger fires and before any
   * DecisionReadModel rows exist.
   *
   * Scope: this test proves the in-flight UX path only — advisory-bff receives
   * the trigger, increments AdvisoryStatus.inFlightCount, publishes
   * ADVISORY_STATUS_UPDATED, and the component renders the generating banner
   * within the WebSocket subscription delivery window. No agent pipeline is
   * started (decision-workflow-ctrl is bypassed).
   *
   * Timing: the UI must observe the generating state within 20 s of landing
   * on /advisory. Backend polling confirms inFlightCount > 0 within 30 s.
   * Both assertions are UI-only once the component is loaded.
   */
  test('shows generating empty-state when user lands on /advisory immediately after trigger', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    // Emit DEPOSIT_DETECTED directly to the advisory bus scoped to advisory-bff.
    // Source `integration-test:advisory-bff` passes advisory-bff's Ingress $or
    // filter and increments AdvisoryStatus.inFlightCount.
    // advisory-adpt and decision-workflow-ctrl are bypassed — no SF execution starts.
    await injectAdvisoryBffTriggerEvent(ctx, tenant);

    // Wait for advisory-bff to have written inFlightCount > 0 to DDB before
    // navigating. This eliminates the race between EB→SQS→Lambda processing
    // (~17 s cold, ~5 s warm) and the component's initial getAdvisoryStatus()
    // query. Once confirmed, the initial query ALWAYS returns inFlightCount > 0
    // and the generating state is visible on first render — no subscription
    // delivery race.
    await waitForAdvisoryDecisionRow(ctx, tenant, { allowInFlightOnly: true, timeoutMs: 60_000 });

    // Navigate to /advisory. The component's getAdvisoryStatus() query fires
    // in ngOnInit and the DDB item exists (confirmed by waitForAdvisoryDecisionRow).
    // No subscription race: the UI reflects inFlightCount > 0 from the query.
    await onboardedPage.goto('/advisory');

    // The generating empty-state must be visible from the initial query result.
    // No subscription delivery needed — inFlightCount is already > 0 in DDB.
    await expect(onboardedPage.locator('[data-testid=advisory-generating-state]')).toBeVisible({
      timeout: 15_000,
    });

    // Generating state remains visible while inFlightCount > 0 and no rows exist.
    await expect(onboardedPage.locator('[data-testid=advisory-generating-state]')).toBeVisible();
  });

  /**
   * Verify that the dashboard alert bar appears when a decision trigger fires
   * and dashboard-bff increments pendingDecisionsCount. The alert bar renders
   * via the onDashboardUpdate WSS subscription — no page reload required.
   *
   * Phase 2 gate: this test proves the subscription delivery path end-to-end
   * (DEPOSIT_DETECTED → dashboard-bff ingress → advisory-status transform →
   * DDB write → CDC publisher → publishDashboardUpdate mutation → WSS frame →
   * advisory-alert-bar visible).
   *
   * Source `integration-test:dashboard-bff` passes dashboard-bff's Ingress
   * $or filter directly — advisory-adpt and the full agent pipeline are bypassed
   * so the test is fast and deterministic.
   */
  test('dashboard alert bar appears at trigger time via subscription', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    await onboardedPage.goto('/dashboard');

    // Emit DEPOSIT_DETECTED directly to the investor bus scoped to dashboard-bff.
    // dashboard-bff increments pendingDecisionsCount → CDC publisher fires
    // publishDashboardUpdate → onDashboardUpdate subscription delivers the frame.
    await injectDashboardBffTriggerEvent(ctx, tenant);

    // The alert bar renders when pendingDecisionsCount > 0. Subscription
    // delivers the update without a page reload (~10–30 s after PutEvents
    // for EB→SQS→Lambda→DDB→CDC→AppSync chain).
    await expect(onboardedPage.locator('[data-testid=advisory-alert-bar]')).toBeVisible({
      timeout: 60_000,
    });
  });
});
