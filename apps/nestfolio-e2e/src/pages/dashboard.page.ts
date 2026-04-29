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
   */
  async waitForPendingDecisionsAtLeast(n: number, timeout = 180_000): Promise<void> {
    await expect(async () => {
      const text = await this.page.locator('.alert-text').innerText();
      const match = /(\d+)\s*$/.exec(text);
      const count = match ? parseInt(match[1], 10) : 0;
      expect(count).toBeGreaterThanOrEqual(n);
    }).toPass({ timeout, intervals: [1000, 2000, 5000] });
  }
}
