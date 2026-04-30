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
   * NOTE: this passes when EITHER the initial getDashboard query OR a WSS
   * frame populates the count. To explicitly verify the WSS live-update
   * path (no page reload), use waitForPendingDecisionsExactly after
   * injecting a sentinel value via injectAdvisoryUpdate.
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
   * Wait for the pending-decisions counter to reach EXACTLY n. Used to
   * verify the WSS live-update path: inject a sentinel value (one the
   * pipeline never produces) via SigV4 against publishDashboardUpdate;
   * if WSS works, the dashboard's subscription delivers the broadcast and
   * the store updates without a page reload.
   */
  async waitForPendingDecisionsExactly(n: number, timeout = 30_000): Promise<void> {
    await expect(async () => {
      const count = await this.getCurrentPendingDecisions();
      expect(count).toBe(n);
    }).toPass({ timeout, intervals: [500, 1000, 2000] });
  }
}
