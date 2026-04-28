import type { Page } from '@playwright/test';

export type RendererTool =
  | 'render_options' | 'render_mode_cards' | 'render_slider'
  | 'render_amount'  | 'render_summary'    | 'render_consent' | 'render_cta';

export type OperatingMode = 'aggressive' | 'balanced' | 'conservative';

export class OnboardingChatPage {
  constructor(readonly page: Page) {}

  goto() {
    return this.page.goto('/onboarding');
  }

  waitForRenderer(tool: RendererTool, timeout = 30_000) {
    return this.page.getByTestId(`renderer-${tool}`).first().waitFor({ timeout });
  }

  selectOption(value: string) {
    return this.page.getByTestId(`option-${value}`).click();
  }

  selectMode(m: OperatingMode) {
    return this.page.getByTestId(`mode-${m}`).click();
  }

  async setSlider(value: number): Promise<void> {
    // Playwright's fill() on a type=range input triggers the Angular (input)
    // handler, which immediately submits the value and replaces the slider
    // with the next phase's renderer. Dispatching follow-up events would
    // race against the renderer swap and fail.
    await this.page.getByTestId('slider-input').fill(String(value));
  }

  /**
   * Fills the amount input. Playwright's fill() triggers the renderer's
   * (input) listener which immediately emits amountChange → submitUserContent,
   * advancing the agent and replacing the amount component before any
   * follow-up event would reach it.
   */
  async setAmount(valueCents: number): Promise<void> {
    const display = (valueCents / 100).toString();
    await this.page.getByTestId('amount-input').fill(display);
  }

  confirmSummary() {
    return this.page.getByTestId('summary-confirm').click();
  }

  grantConsent() {
    return this.page.getByTestId('consent-accept').click();
  }

  clickCta() {
    return this.page.getByTestId('cta-primary').click();
  }

  async sendMessage(text: string): Promise<void> {
    await this.page.getByPlaceholder('Scrivi un messaggio...').fill(text);
    await this.page.getByRole('button', { name: 'Invia' }).click();
  }

  async phaseIndex(): Promise<number> {
    // Progress label renders as "<phaseIndex+1> di <total>" — parse back.
    const label = await this.page.locator('.progress-label').first().innerText();
    const match = /^(\d+)\s+di\s+\d+$/.exec(label.trim());
    if (!match) throw new Error(`Unexpected progress label: "${label}"`);
    return parseInt(match[1], 10) - 1;
  }

  async waitForAssistantReply(timeout = 60_000): Promise<void> {
    await this.page
      .locator('.chat-bubble.assistant')
      .filter({ hasText: /\S/ })
      .last()
      .waitFor({ timeout });
  }
}
