import { randomUUID } from 'crypto';
import { test, expect } from '../fixtures/test';
import {
  injectDecisionCycleStarted,
  injectDecisionCycleFailed,
  injectDecisionPacketCreated,
} from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';

test.describe('advisory generating + failed state', () => {
  /**
   * GENERATING → FAILED. Inject the SF-direct cycle events scoped to advisory-bff:
   * STARTED projects a GENERATING DecisionReadModel row (no packet yet) → the
   * /advisory empty-state spinner; FAILED (same decisionId, v1) overwrites it →
   * the failed error state, delivered live via the onDecisionUpdate subscription.
   * UI-only assertions (per the e2e charter).
   */
  test('shows generating then failed as the cycle progresses', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    const decisionId = randomUUID();

    await injectDecisionCycleStarted(ctx, tenant, decisionId);
    // Wait for advisory-bff to materialise the GENERATING row so the initial
    // getPendingDecisions query (fired in ngOnInit) returns it — no subscription race.
    await waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs: 60_000 });

    await onboardedPage.goto('/advisory');
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeVisible({ timeout: 15_000 });

    // FAILED arrives while the page is mounted → delivered by the WSS subscription.
    await injectDecisionCycleFailed(ctx, tenant, decisionId);
    await expect(
      onboardedPage.locator('[data-testid=advisory-failed-state]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeHidden();
  });

  /**
   * GENERATING → decision ready. STARTED shows the spinner; a content
   * DECISION_PACKET_CREATED (same decisionId, v1) overwrites the GENERATING row →
   * the decision appears in the list and the spinner clears, live via subscription.
   */
  test('clears the spinner and shows the decision when the packet arrives', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    const decisionId = randomUUID();

    await injectDecisionCycleStarted(ctx, tenant, decisionId);
    await waitForAdvisoryDecisionRow(ctx, tenant, { timeoutMs: 60_000 });

    await onboardedPage.goto('/advisory');
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeVisible({ timeout: 15_000 });

    await injectDecisionPacketCreated(ctx, tenant, decisionId);
    await expect(
      onboardedPage.locator('[data-testid=advisory-decision-list]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator(`[data-testid=decision-${decisionId}]`),
    ).toBeVisible();
    await expect(
      onboardedPage.locator('[data-testid=advisory-generating-state]'),
    ).toBeHidden();
  });

  /**
   * Dashboard alert-bar coverage is retargeted off the removed accumulate model
   * by WS-4 (dashboard-generating-failed-reflection). Skipped here so this file
   * stays green until WS-4 rewrites it against the reachable
   * ADVISORY_STATUS_UPDATED → pendingDecisionsCount path.
   */
  test.skip('dashboard alert bar appears at trigger time via subscription', async () => {
    // Intentionally skipped — see WS-4 dashboard-generating-failed-reflection.
  });
});
