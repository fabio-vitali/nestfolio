import { expect, type Page } from '@playwright/test';

export class DashboardPage {
  constructor(readonly page: Page) {}

  goto() {
    return this.page.goto('/dashboard');
  }

  /** Wait for the KPI cards row — proves the dashboard read model loaded. */
  async waitForLoaded(timeout = 60_000): Promise<void> {
    await this.page.getByTestId('cta-deposit').waitFor({ timeout });
  }

  clickDeposit() {
    return this.page.getByTestId('cta-deposit').click();
  }

  /**
   * Wait for AdvisoryAlertBar's pending-decisions counter to reach n.
   * Counter renders inside `.alert-text` as
   *   "<i18n: advisory.pendingDecisions>: <N>"
   * Match the trailing integer regardless of the localised label.
   *
   * NOTE: passes when EITHER the initial getDashboard query OR a WSS frame
   * populates the count. To prove the WSS live-update path specifically,
   * call this after a real-EB inject WITHOUT navigating between inject and
   * assert — the only path the new value can travel without a reload is the
   * onDashboardUpdate broadcast.
   */
  async waitForPendingDecisionsAtLeast(n: number, timeout = 180_000): Promise<void> {
    await expect(async () => {
      const count = await this.getCurrentPendingDecisions();
      expect(count).toBeGreaterThanOrEqual(n);
    }).toPass({ timeout, intervals: [1000, 2000, 5000] });
  }

  /**
   * Read the AdvisoryAlertBar counter value right now. Throws if .alert-text
   * is not present in the DOM (alert-bar is gated by hasAdvisoryAlerts() so
   * absence indicates count == 0 in the store).
   */
  async getCurrentPendingDecisions(): Promise<number> {
    const text = await this.page.locator('.alert-text').innerText();
    const match = /(\d+)\s*$/.exec(text);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Wait until the activity feed contains an entry with the given activityId.
   *
   * WSS proof: the row only reaches the DOM via the onActivityUpdate broadcast
   * (no page reload between inject and assert). Activity rows are append-only
   * so this assertion does not race with concurrent DECISION_APPROVED decrements.
   */
  async waitForActivityByEventId(activityId: string, timeout = 30_000): Promise<void> {
    await this.page
      .locator(`.activity-item[data-activity-id="${activityId}"]`)
      .waitFor({ state: 'visible', timeout });
  }

}
