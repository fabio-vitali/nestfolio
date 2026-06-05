import { randomUUID } from 'crypto';
import { test, expect } from '../fixtures/test';
import {
  injectDecisionCycleStarted,
  injectDecisionCycleFailed,
  injectDecisionPacketCreated,
  injectAdvisoryStatusUpdated,
} from '../fixtures/inject-advisory-update';
import { waitForAdvisoryDecisionRow } from '../fixtures/wait-for-advisory-projection';
import { waitForDashboardAdvisoryStatus } from '../fixtures/wait-for-dashboard-advisory';

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
   * Dashboard reflects the cycle: a fresh GENERATING aggregate shows the dashboard
   * generating banner (deterministic on-mount query after the row exists); a FAILED
   * announcement flips it to the failed banner live via onDashboardUpdate; a
   * pendingDecisionsCount announcement then shows the "ready to review" alert bar
   * (the reachable path the removed accumulate test was rewritten onto).
   * UI-only assertions (per the e2e charter); versions strictly increase.
   */
  test('dashboard reflects generating, failed, then ready-to-review', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    // GENERATING: project the row first, then load so the on-mount query returns it.
    await injectAdvisoryStatusUpdated(ctx, tenant, {
      generatingCount: 1,
      oldestGeneratingAt: new Date().toISOString(),
      version: 1,
    });
    await waitForDashboardAdvisoryStatus(ctx, tenant, (s) => s.generatingCount >= 1, {
      timeoutMs: 60_000,
    });

    await onboardedPage.goto('/dashboard');
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-generating]'),
    ).toBeVisible({ timeout: 15_000 });

    // FAILED arrives while mounted → delivered live by the WSS subscription.
    await injectAdvisoryStatusUpdated(ctx, tenant, { failedCount: 1, version: 2 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-failed]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-generating]'),
    ).toBeHidden();

    // Decisions become ready to review → the alert bar (failed banner clears).
    await injectAdvisoryStatusUpdated(ctx, tenant, { pendingDecisionsCount: 2, version: 3 });
    await expect(
      onboardedPage.locator('[data-testid=advisory-alert-bar]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      onboardedPage.locator('[data-testid=dashboard-advisory-failed]'),
    ).toBeHidden();
  });
});
