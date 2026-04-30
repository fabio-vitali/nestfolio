import { expect, type Page } from '@playwright/test';

export class AdvisoryPage {
  constructor(readonly page: Page) {}

  /**
   * Navigate to /advisory (list view) and click the first decision card.
   * The list renders after DashboardPage.waitForPendingDecisionsAtLeast(1)
   * has confirmed the projection materialised.
   *
   * decisionId in this codebase = upstream EventBridge eventId (32-char hex,
   * no dashes — see decision-workflow-ctrl/event-listener.ts:24). The URL
   * assertion accepts any non-empty path segment after /advisory/.
   */
  async goToFirstPendingDecision(): Promise<void> {
    await this.page.goto('/advisory');
    const decision = this.page.locator(
      'a[data-testid^="decision-"], a[href^="/advisory/"]:not([href="/advisory"])',
    ).first();
    await decision.click();
    await expect(this.page).toHaveURL(/\/advisory\/[^/]+$/);
  }

  async waitForRationale(timeout = 60_000): Promise<void> {
    await this.page.locator('.rationale').waitFor({ timeout });
  }

  async rationaleText(): Promise<string> {
    return (await this.page.locator('.rationale').innerText()).trim();
  }

  /** Click Confirm. Match by accessible role+name to survive PrimeNG churn. */
  async confirm(): Promise<void> {
    await this.page.getByRole('button', { name: /confirm|conferma/i }).click();
  }

  async waitForConfirmed(timeout = 60_000): Promise<void> {
    // Success banner appears via PrimeNG's <p-message severity="success"> or
    // the rendered .p-message-success container.
    await expect(
      this.page.locator('p-message[severity="success"], .p-message-success'),
    ).toBeVisible({ timeout });
  }
}
