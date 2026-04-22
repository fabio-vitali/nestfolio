import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DepositPageComponent } from '../../../src/app/deposit/deposit-page.component';
import {
  DepositService,
  type DepositIntent,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';

describe('DepositPageComponent', () => {
  let component: DepositPageComponent;
  let fixture: ComponentFixture<DepositPageComponent>;
  let deposit: jest.Mocked<Pick<DepositService, 'initiateDeposit' | 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent'>>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  const intent: DepositIntent = {
    depositId: 'dep-1',
    amountCents: 10_000,
    currency: 'USD',
    status: 'INITIATED',
    initiatedAt: '2026-04-22T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    deposit = {
      initiateDeposit: jest.fn().mockResolvedValue(intent),
      subscribeToDepositEvent: jest.fn(),
      unsubscribeFromDepositEvent: jest.fn(),
    };
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(DepositPageComponent, {
      providers: [
        { provide: DepositService, useValue: deposit },
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });
    component = fixture.componentInstance;
  });

  afterEach(() => { jest.useRealTimers(); });

  it('initializes in the form state', () => {
    expect(component.state()).toBe('form');
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

  it('confirm is disabled when the initiateDeposit feature flag is off', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(true);
  });

  it('submit: transitions form → submitting → initiated and opens the subscription', async () => {
    component.amount.set(100);
    const submitPromise = component.submit();
    expect(component.state()).toBe('submitting');
    await submitPromise;

    expect(deposit.initiateDeposit).toHaveBeenCalledWith({ amountCents: 10_000, currency: 'USD' });
    expect(component.state()).toBe('initiated');
    expect(component.depositIntent()).toEqual(intent);
    expect(deposit.subscribeToDepositEvent).toHaveBeenCalledWith('dep-1', expect.any(Function));
  });

  it('subscription DETECTED payload: transitions initiated → detected and sets depositEvent', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    const detectedEvent: DepositEvent = {
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
    onEvent(detectedEvent);

    expect(component.state()).toBe('detected');
    expect(component.depositEvent()).toEqual(detectedEvent);
  });

  it('subscription FAILED payload: transitions initiated → failed with reason', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'FAILED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: 'Broker unavailable',
    });

    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Broker unavailable');
  });

  it('30s without subscription update transitions initiated → timeout (subscription stays open)', async () => {
    component.amount.set(100);
    await component.submit();
    jest.advanceTimersByTime(30_000);

    expect(component.state()).toBe('timeout');
    expect(deposit.unsubscribeFromDepositEvent).not.toHaveBeenCalled();
  });

  it('late DETECTED after timeout still transitions to detected', async () => {
    component.amount.set(100);
    await component.submit();
    jest.advanceTimersByTime(30_000);
    expect(component.state()).toBe('timeout');

    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];
    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:02:00.000Z', reason: null,
    });
    expect(component.state()).toBe('detected');
  });

  it('submit failure (feature-flag disabled from server): transitions submitting → failed', async () => {
    deposit.initiateDeposit.mockRejectedValueOnce(new Error('This action is temporarily paused'));
    component.amount.set(100);
    await component.submit();

    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('This action is temporarily paused');
  });

  it('cancel: navigates to /dashboard', () => {
    component.cancel();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('tryAgain from failed: resets to form, clears the previous intent', async () => {
    deposit.initiateDeposit.mockRejectedValueOnce(new Error('Oops'));
    component.amount.set(100);
    await component.submit();
    expect(component.state()).toBe('failed');

    component.tryAgain();
    expect(component.state()).toBe('form');
    expect(component.depositIntent()).toBeNull();
    expect(component.failureReason()).toBeNull();
  });

  it('viewDashboard: navigates back to /dashboard from detected state', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];
    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '', reason: null,
    });

    component.viewDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ngOnDestroy unsubscribes from the deposit event stream', () => {
    component.ngOnDestroy();
    expect(deposit.unsubscribeFromDepositEvent).toHaveBeenCalled();
  });
});
