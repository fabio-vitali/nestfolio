import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DepositFormComponent } from '../../../src/app/deposit/deposit-form.component';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';

describe('DepositFormComponent', () => {
  let component: DepositFormComponent;
  let fixture: ComponentFixture<DepositFormComponent>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  beforeEach(async () => {
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(DepositFormComponent, {
      providers: [
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });
    component = fixture.componentInstance;
  });

  it('confirm is disabled when amount is empty, zero, or negative', () => {
    component.amount.set(null);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(0);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(-5);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(false);
  });

  it('confirm is disabled when initiateDeposit feature flag is off', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(true);
  });

  it('submit: generates a UUIDv4 depositId and navigates to /deposit/:id with router state', () => {
    const uuidSpy = jest.spyOn(crypto, 'randomUUID').mockReturnValue(
      '44444444-4444-4444-8444-444444444444' as `${string}-${string}-${string}-${string}-${string}`,
    );
    component.amount.set(100);
    component.submit();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/deposit', '44444444-4444-4444-8444-444444444444'],
      { state: { amountCents: 10_000, currency: 'USD' } },
    );
    uuidSpy.mockRestore();
  });

  it('submit: no-op when confirmDisabled (does not navigate)', () => {
    component.amount.set(0);
    component.submit();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('cancel: navigates to /dashboard', () => {
    component.cancel();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
