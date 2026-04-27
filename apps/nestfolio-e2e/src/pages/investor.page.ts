import type { Page } from '@playwright/test';

export class InvestorPage {
  constructor(readonly page: Page) {}

  gotoDeposit() {
    return this.page.goto('/investor/deposit');
  }

  waitForDepositForm(timeout = 30_000) {
    return this.page.getByTestId('deposit-form').waitFor({ timeout });
  }

  async enterAmount(amount: number): Promise<void> {
    // p-inputNumber renders a real <input> inside the data-testid wrapper.
    const inputWrapper = this.page.getByTestId('deposit-amount');
    const nativeInput = inputWrapper.locator('input');
    await nativeInput.fill(String(amount));
    await nativeInput.blur();
  }

  confirm() {
    return this.page.getByTestId('deposit-confirm').click();
  }

  waitForInitiated(timeout = 60_000) {
    return this.page.getByTestId('deposit-panel-initiated').waitFor({ timeout });
  }

  waitForDetected(timeout = 120_000) {
    return this.page.getByTestId('deposit-panel-detected').waitFor({ timeout });
  }
}
