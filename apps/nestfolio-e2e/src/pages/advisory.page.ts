import { expect, type Page } from '@playwright/test';

export class AdvisoryPage {
  constructor(readonly page: Page) {}

  /**
   * Navigate to /advisory (list view) and click the first decision card.
   * The list renders after DashboardPage.waitForPendingDecisionsAtLeast(1)
   * has confirmed the projection materialised.
   *
   * The list-item testid is not yet present in advisory-mfe; the selector
   * matches the first link/button under the list container as a fallback.
   * If the list-item testid lands later (e.g. data-testid="decision-<id>"),
   * tighten this selector then.
   */
  async goToFirstPendingDecision(): Promise<void> {
    await this.page.goto('/advisory');
    const decision = this.page.locator(
      '[data-testid^="decision-"], a[href^="/advisory/"]',
    ).first();
    await decision.click();
    await expect(this.page).toHaveURL(/\/advisory\/[0-9a-f-]{36}/);
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
