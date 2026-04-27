import type { Page } from '@playwright/test';

export type RendererTool =
  | 'render_options' | 'render_mode_cards' | 'render_slider'
  | 'render_amount'  | 'render_summary'    | 'render_consent' | 'render_cta';

export type OperatingMode = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE';

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
    const slider = this.page.getByTestId('slider-input');
    await slider.fill(String(value));
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');
  }

  /**
   * Fills the amount input. The renderer's `(input)` listener emits amountChange
   * per keystroke, which Phase 2.5's mountRenderer wires to submitUserContent —
   * no separate submit button exists or is needed.
   */
  async setAmount(valueCents: number): Promise<void> {
    const display = (valueCents / 100).toString();
    const input = this.page.getByTestId('amount-input');
    await input.fill(display);
    await input.dispatchEvent('input');
    await input.blur();
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
