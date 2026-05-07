import { ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DepositPendingPageComponent } from '../../../src/app/deposit/deposit-pending-page.component';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';

const depositId = '55555555-5555-4555-8555-555555555555';

const initiated: Deposit = {
  depositId, amountCents: 10_000, currency: 'USD',
  status: 'INITIATED', initiatedAt: '2026-04-22T00:00:00.000Z',
  detectedAt: null, failedAt: null, reason: null,
};
const detected: Deposit = { ...initiated, status: 'DETECTED', detectedAt: '2026-04-22T00:01:00.000Z' };
const failed: Deposit = {
  ...initiated, status: 'FAILED', failedAt: '2026-04-22T00:01:00.000Z',
  reason: 'Broker rejected',
};

function configureWithRouterState(state: unknown) {
  Object.defineProperty(history, 'state', { value: state, writable: true, configurable: true });
}

async function mountWith(opts: {
  deposit: jest.Mocked<Pick<DepositService, 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent' | 'waitForSubscriptionReady' | 'getDeposit' | 'initiateDeposit'>>;
  routerState?: unknown;
}): Promise<{ fixture: ComponentFixture<DepositPendingPageComponent>; component: DepositPendingPageComponent; router: ReturnType<typeof createMockRouter> }> {
  jest.useFakeTimers();
  configureWithRouterState(opts.routerState ?? {});
  const router = createMockRouter();
  const route = {
    snapshot: { paramMap: { get: (k: string) => (k === 'depositId' ? depositId : null) } },
  };
  const fixture = await setupComponentTest(DepositPendingPageComponent, {
    providers: [
      { provide: DepositService, useValue: opts.deposit },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: route },
      { provide: I18nService, useValue: createMockI18nService() },
    ],
  });
  return { fixture, component: fixture.componentInstance, router };
}

describe('DepositPendingPageComponent', () => {
  let deposit: jest.Mocked<Pick<DepositService, 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent' | 'waitForSubscriptionReady' | 'getDeposit' | 'initiateDeposit'>>;

  beforeEach(() => {
    deposit = {
      subscribeToDepositEvent: jest.fn(),
      unsubscribeFromDepositEvent: jest.fn(),
      waitForSubscriptionReady: jest.fn().mockResolvedValue(undefined),
      getDeposit: jest.fn(),
      initiateDeposit: jest.fn(),
    };
  });

  afterEach(() => { jest.useRealTimers(); });

  it('REGRESSION: subscribe is called before initiateDeposit (race fix)', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();

    const subOrder = deposit.subscribeToDepositEvent.mock.invocationCallOrder[0];
    const mutOrder = deposit.initiateDeposit.mock.invocationCallOrder[0];
    expect(subOrder).toBeLessThan(mutOrder);
  });

  it('hydrates as INITIATED from getDeposit (reload before DETECTED)', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('initiated');
    expect(component.deposit()).toEqual(initiated);
    expect(deposit.initiateDeposit).not.toHaveBeenCalled();
  });

  it('hydrates as DETECTED from getDeposit (reload after DETECTED) — no timeout armed', async () => {
    deposit.getDeposit.mockResolvedValue(detected);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('detected');
    jest.advanceTimersByTime(60_000);
    expect(component.state()).toBe('detected');
  });

  it('hydrates as FAILED from getDeposit with reason', async () => {
    deposit.getDeposit.mockResolvedValue(failed);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Broker rejected');
  });

  it('on NotFound + populated history.state: fires initiateDeposit with depositId from URL', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();
    expect(deposit.initiateDeposit).toHaveBeenCalledWith({
      depositId, amountCents: 10_000, currency: 'USD',
    });
    expect(component.state()).toBe('initiated');
  });

  it('on NotFound + empty history.state: shows invalidUrl panel, never mutates', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    const { component } = await mountWith({ deposit, routerState: {} });
    await component.ngOnInit();
    expect(component.state()).toBe('invalidUrl');
    expect(deposit.initiateDeposit).not.toHaveBeenCalled();
  });

  it('subscription DETECTED frame after INITIATED hydration → state=detected, timeout cleared', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    const evt: DepositEvent = {
      depositId, tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
    onEvent(evt);
    expect(component.state()).toBe('detected');

    jest.advanceTimersByTime(60_000);
    expect(component.state()).toBe('detected');
  });

  it('30s timeout in INITIATED → state=timeout (subscription stays open)', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    jest.advanceTimersByTime(30_000);
    expect(component.state()).toBe('timeout');
    expect(deposit.unsubscribeFromDepositEvent).not.toHaveBeenCalled();
  });

  it('initiateDeposit rejection on fresh-submit branch → state=failed', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockRejectedValue(new Error('Circuit open'));
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Circuit open');
  });

  it('waitForSubscriptionReady rejection → state=failed', async () => {
    deposit.waitForSubscriptionReady.mockRejectedValue(new Error('WS connection failed'));
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(deposit.getDeposit).not.toHaveBeenCalled();
  });

  it('viewDashboard from detected: navigates to /dashboard', async () => {
    deposit.getDeposit.mockResolvedValue(detected);
    const { component, router } = await mountWith({ deposit });
    await component.ngOnInit();
    component.viewDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ngOnDestroy unsubscribes and clears timeout', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    component.ngOnDestroy();
    expect(deposit.unsubscribeFromDepositEvent).toHaveBeenCalled();
  });
});
