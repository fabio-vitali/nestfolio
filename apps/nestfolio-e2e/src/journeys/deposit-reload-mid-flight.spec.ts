import { test, expect } from '../fixtures/test';
import { OnboardingChatPage, type OperatingMode } from '../pages/onboarding.page';
import { DashboardPage } from '../pages/dashboard.page';
import { InvestorPage } from '../pages/investor.page';

test('deposit reload mid-flight: pending panel re-hydrates after F5, DETECTED still arrives', async ({
  authedPage,
}) => {
  const onboarding = new OnboardingChatPage(authedPage);
  const dashboard = new DashboardPage(authedPage);
  const investor = new InvestorPage(authedPage);

  // Prologue — onboard a fresh tenant to reach the dashboard. Mirrors steps
  // 2-6 of `new-investor-happy-path.spec.ts`; the AgentTraceTrap + KB step
  // are intentionally omitted (they exercise observability orthogonal to
  // the deposit flow).
  await test.step('route to onboarding', async () => {
    await onboarding.goto();
    await expect(authedPage).toHaveURL(/\/onboarding$/);
    await onboarding.waitForRenderer('render_options', 60_000);
  });

  await test.step('phase 0: options', async () => {
    await onboarding.selectOption('growth');
    await onboarding.waitForRenderer('render_mode_cards');
  });

  const pickedMode: OperatingMode = 'balanced';
  await test.step('phase 1: mode cards', async () => {
    await onboarding.selectMode(pickedMode);
    await onboarding.waitForRenderer('render_slider');
  });

  await test.step('phase 2: slider', async () => {
    await onboarding.setSlider(10);
    await onboarding.waitForRenderer('render_amount');
  });

  await test.step('phase 3: amount', async () => {
    await onboarding.setAmount(50_000_00);
    await onboarding.waitForRenderer('render_summary');
  });

  await test.step('phase 4: summary', async () => {
    await onboarding.confirmSummary();
    await onboarding.waitForRenderer('render_consent');
  });

  await test.step('phase 5: consent', async () => {
    await onboarding.grantConsent();
    await onboarding.waitForRenderer('render_cta');
  });

  await test.step('phase 6: CTA → redirect', async () => {
    await onboarding.clickCta();
    await expect(authedPage).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  });

  await test.step('dashboard loaded', async () => {
    await dashboard.waitForLoaded();
  });

  // Pattern B scenario starts here.

  await test.step('reach deposit form', async () => {
    await dashboard.clickDeposit();
    await expect(authedPage).toHaveURL(/\/investor\/deposit$/);
    await investor.waitForDepositForm();
  });

  await test.step('submit + capture pending URL', async () => {
    await investor.enterAmount(5000);
    await investor.confirm();
    await expect(authedPage).toHaveURL(/\/investor\/deposit\/[0-9a-f-]+$/);
    await investor.waitForInitiated();
  });

  const pendingUrl = authedPage.url();

  await test.step('reload before DETECTED arrives', async () => {
    await authedPage.reload();
    await expect(authedPage).toHaveURL(pendingUrl);
    await investor.waitForInitiated();
  });

  await test.step('DETECTED still arrives on the re-attached subscription', async () => {
    await investor.waitForDetected();
  });
});
