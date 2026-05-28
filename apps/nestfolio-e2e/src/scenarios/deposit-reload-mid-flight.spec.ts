import { test, expect } from '../fixtures/test';
import { InvestorPage } from '../pages/investor.page';

test('deposit reload mid-flight: pending panel re-hydrates after F5, DETECTED still arrives', async ({
  onboardedPage,
}) => {
  const investor = new InvestorPage(onboardedPage);

  await test.step('reach deposit form', async () => {
    await investor.gotoDeposit();
    await expect(onboardedPage).toHaveURL(/\/investor\/deposit$/);
    await investor.waitForDepositForm();
  });

  await test.step('submit + capture pending URL', async () => {
    await investor.enterAmount(5000);
    await investor.confirm();
    await expect(onboardedPage).toHaveURL(/\/investor\/deposit\/[0-9a-f-]+$/);
    await investor.waitForInitiated();
  });

  const pendingUrl = onboardedPage.url();

  await test.step('reload before DETECTED arrives', async () => {
    await onboardedPage.reload();
    await expect(onboardedPage).toHaveURL(pendingUrl);
    await investor.waitForInitiated();
  });

  await test.step('DETECTED still arrives on the re-attached subscription', async () => {
    await investor.waitForDetected();
  });
});
