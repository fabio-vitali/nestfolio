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

  /**
   * Click Confirm. Match by accessible role+name to survive PrimeNG churn.
   * If the button never appears (e.g. decision landed BLOCKED instead of
   * AWAITING_CONFIRMATION) surface the actually-rendered status badge so the
   * failure points at the upstream cause rather than at "button not found".
   */
  async confirm(): Promise<void> {
    const button = this.page.getByRole('button', { name: /confirm|conferma/i });
    try {
      await button.click({ timeout: 15_000 });
    } catch (err) {
      const status = await this.page
        .locator('.headline-top .nf-badge')
        .first()
        .innerText()
        .catch(() => '<status badge not rendered>');
      throw new Error(
        `advisory.page.confirm(): Confirm button never appeared. Decision status badge = "${status.trim()}". ` +
          `Expected AWAITING_CONFIRMATION (L2 path). Underlying cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async waitForConfirmed(timeout = 60_000): Promise<void> {
    // Success banner appears via PrimeNG's <p-message severity="success"> or
    // the rendered .p-message-success container.
    await expect(
      this.page.locator('p-message[severity="success"], .p-message-success'),
    ).toBeVisible({ timeout });
  }
}
