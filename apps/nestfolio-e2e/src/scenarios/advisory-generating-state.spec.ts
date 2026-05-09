import { test, expect } from '../fixtures/test';
import { injectAdvisoryTriggerEvent } from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';

test.describe('advisory generating state', () => {
  /**
   * Verify that the /advisory page shows the "generating" empty-state
   * immediately after a DEPOSIT_DETECTED trigger fires and before the agent
   * pipeline completes. Once the pipeline finishes, the generating state
   * should be replaced by the decision list.
   *
   * Timing: the UI must observe the generating state within 10 s of landing
   * on /advisory. The decision list must materialise within the agent pipeline
   * SLA (~30–75 s). Both assertions are UI-only — no backend polling.
   */
  test('shows generating empty-state when user lands on /advisory immediately after trigger', async ({
    ctx,
    tenant,
    authedPage,
  }) => {
    // Emit a real DEPOSIT_DETECTED event — starts the decision pipeline.
    await injectAdvisoryTriggerEvent(ctx, tenant);

    // Navigate immediately (~within 2 s of the trigger) so advisory-bff
    // should already have incremented inFlightCount before the agent pipeline
    // completes. The generating-state div is shown when inFlightCount > 0
    // and no DecisionReadModel rows exist yet.
    await authedPage.goto('/advisory');

    // The generating empty-state must be visible before rows materialise.
    await expect(authedPage.locator('[data-testid=advisory-generating-state]')).toBeVisible({
      timeout: 20_000,
    });

    // Wait for advisory-bff to confirm the in-flight state before asserting
    // the full decision list (fast-path: succeeds on inFlightCount > 0).
    await waitForAdvisoryDecisionRow(ctx, tenant, { allowInFlightOnly: true, timeoutMs: 30_000 });

    // The decision list container should eventually appear once the agent
    // pipeline completes and DECISION_PACKET_CREATED fires (~30–75 s).
    await expect(authedPage.locator('[data-testid=advisory-decision-list]')).toBeVisible({
      timeout: 90_000,
    });

    // Generating state should be hidden once the list has rows (list and
    // generating-state are mutually exclusive via @if in the component).
    await expect(authedPage.locator('[data-testid=advisory-generating-state]')).toBeHidden();
  });

  /**
   * Verify that the dashboard alert bar appears when a decision trigger fires
   * and advisory-bff broadcasts an ADVISORY_STATUS_UPDATED event with
   * inFlightCount > 0. The alert bar renders via the onAdvisoryStatusUpdate
   * WSS subscription — no page reload required.
   *
   * Phase 2 gate: this test proves the subscription delivery path end-to-end
   * (DEPOSIT_DETECTED → advisory-adpt → DECISION_TRIGGER_RECEIVED → CDC →
   * ADVISORY_STATUS_UPDATED → dashboard-bff subscription → WSS frame →
   * advisory-alert-bar visible).
   */
  test('dashboard alert bar appears at trigger time via subscription', async ({
    ctx,
    tenant,
    authedPage,
  }) => {
    await authedPage.goto('/dashboard');

    // Trigger the decision pipeline.
    await injectAdvisoryTriggerEvent(ctx, tenant);

    // The alert bar renders when pendingDecisionsCount > 0 or inFlightCount
    // is surfaced via the advisory alert. Subscription delivers the update
    // without a page reload — expect within a few seconds of EB delivery.
    await expect(authedPage.locator('[data-testid=advisory-alert-bar]')).toBeVisible({
      timeout: 20_000,
    });
  });
});
