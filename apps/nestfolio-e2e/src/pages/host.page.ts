import { expect, type Page } from '@playwright/test';

export class HostPage {
  constructor(readonly page: Page) {}

  logout() {
    return this.page.getByTestId('cta-logout').click();
  }

  async waitForLogin(timeout = 30_000): Promise<void> {
    await expect(this.page).toHaveURL(/\/login$/, { timeout });
  }

  async assertAuthStoreUnauthenticated(): Promise<void> {
    // LogoutButtonComponent renders only when authStore.status() === 'authenticated'.
    // Its absence is the UI-visible proof the store is reset.
    await expect(this.page.getByTestId('cta-logout')).toBeHidden();
  }
}
