import type { Page } from '@playwright/test';

/**
 * GoLivePage — POM for the 6-step go-live wizard at /investor/settings/go-live.
 *
 * Step 0 Risk → Step 1 Goals → Step 2 OperatingMode → Step 3 Mandate
 *   → Step 4 Fund (skipped) → Step 5 Confirm
 *
 * The wizard pre-seeds all selects from getProfile(), so the happy path
 * accepts seeded values and only advances using step-next-btn.
 * The mandate checkbox MUST be checked before step-next-btn is enabled.
 */
export class GoLivePage {
  constructor(readonly page: Page) {}

  /** Navigate to the wizard and wait until the first step (Risk) is visible. */
  async goto(timeout = 30_000): Promise<void> {
    await this.page.goto('/investor/settings/go-live');
    await this.page.getByTestId('risk-tolerance-input').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 0 — Risk: accept pre-seeded values and advance.
   * Waits for Step 1 (Goals) hallmark before returning.
   */
  async advanceRisk(timeout = 30_000): Promise<void> {
    await this.page.getByTestId('step-next-btn').click();
    // Wait for the Goals step hallmark
    await this.page.getByTestId('goal-objective-input').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 1 — Goals: accept pre-seeded value and advance.
   * Waits for Step 2 (OperatingMode) hallmark before returning.
   */
  async advanceGoals(timeout = 30_000): Promise<void> {
    await this.page.getByTestId('step-next-btn').click();
    // Wait for the OperatingMode step hallmark
    await this.page.getByTestId('operating-mode-select').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 2 — OperatingMode: accept pre-seeded value and advance.
   * Waits for Step 3 (Mandate) hallmark before returning.
   */
  async advanceOperatingMode(timeout = 30_000): Promise<void> {
    await this.page.getByTestId('step-next-btn').click();
    // Wait for the Mandate step hallmark (the checkbox)
    await this.page.getByTestId('mandate-accept-checkbox').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 3 — Mandate: check the binary p-checkbox then advance.
   *
   * PrimeNG p-checkbox renders the `data-testid` on the component host element.
   * Clicking the host element toggles the checkbox state. We verify the
   * step-next-btn becomes enabled before clicking it to confirm the state flipped.
   * Waits for Step 4 (Fund) hallmark before returning.
   */
  async acceptMandate(timeout = 30_000): Promise<void> {
    const checkbox = this.page.getByTestId('mandate-accept-checkbox');
    await checkbox.click();
    // Confirm the next button is no longer disabled (mandate was accepted)
    const nextBtn = this.page.getByTestId('step-next-btn');
    await nextBtn.waitFor({ state: 'visible', timeout });
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="step-next-btn"]');
        return btn && !(btn as HTMLButtonElement).disabled;
      },
      { timeout },
    );
    await nextBtn.click();
    // Wait for the Fund step (no specific input — just the fund-account-link)
    await this.page.getByTestId('fund-account-link').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 4 — Fund: skip funding and advance to Confirm.
   * Waits for Step 5 (Confirm) hallmark before returning.
   */
  async skipFund(timeout = 30_000): Promise<void> {
    await this.page.getByTestId('step-next-btn').click();
    // Wait for the Confirm step hallmark
    await this.page.getByTestId('confirm-go-live-btn').waitFor({ state: 'visible', timeout });
  }

  /**
   * Step 5 — Confirm: click the danger confirm button.
   * The component navigates to /dashboard on success.
   */
  async confirm(): Promise<void> {
    await this.page.getByTestId('confirm-go-live-btn').click();
  }

  /**
   * Walk all 6 steps end-to-end: Risk → Goals → Mode → Mandate → Fund(skip) → Confirm.
   * Each step waits for the next step's hallmark testid before advancing, so no
   * fixed sleeps are needed — advancement is gated on async save mutations completing.
   */
  async completeAndGoLive(): Promise<void> {
    await this.advanceRisk();
    await this.advanceGoals();
    await this.advanceOperatingMode();
    await this.acceptMandate();
    await this.skipFund();
    await this.confirm();
  }
}
