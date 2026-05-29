import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { DashboardContainerComponent } from '../../../src/app/dashboard/dashboard-container.component';
import { DashboardStore, type ActivityEntry } from '../../../src/app/stores/dashboard.store';
import { DashboardService } from '../../../src/app/services/dashboard.service';
import { AuthStore } from '@nestfolio/shell';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shell/testing';

describe('DashboardContainerComponent', () => {
  let component: DashboardContainerComponent;
  let store: InstanceType<typeof DashboardStore>;
  let mockService: jest.Mocked<DashboardService>;

  beforeEach(async () => {
    mockService = {
      getDashboard: jest.fn().mockResolvedValue({
        portfolioSummary: { totalValueCents: 100 },
        advisoryStatus: null,
        investorSnapshot: null,
      }),
      getPositionSnapshots: jest.fn().mockResolvedValue([]),
      getRecentActivity: jest.fn().mockResolvedValue([]),
      getSimulationSummary: jest.fn().mockResolvedValue(null),
      subscribeToDashboardUpdates: jest.fn(() => new Subject()),
      subscribeToActivityUpdates: jest.fn(() => new Subject()),
      invalidateCaches: jest.fn(),
    } as unknown as jest.Mocked<DashboardService>;

    const fixture = await setupComponentTest(DashboardContainerComponent, {
      providers: [
        { provide: DashboardService, useValue: mockService },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });

    store = TestBed.inject(DashboardStore);
    store.reset();
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load dashboard data on init', async () => {
    await component.ngOnInit();

    expect(mockService.getDashboard).toHaveBeenCalled();
    expect(mockService.getPositionSnapshots).toHaveBeenCalled();
    expect(mockService.getRecentActivity).toHaveBeenCalledWith(20);
    expect(mockService.getSimulationSummary).toHaveBeenCalled();
  });

  it('should set store data after successful load', async () => {
    await component.ngOnInit();

    expect(store.portfolioSummary()).toEqual({ totalValueCents: 100 });
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should set error on load failure', async () => {
    mockService.getDashboard.mockRejectedValue(new Error('Network fail'));

    await component.ngOnInit();

    expect(store.error()).toBe('Network fail');
    expect(store.loading()).toBe(false);
  });

  it('should set generic error for non-Error throws', async () => {
    mockService.getDashboard.mockRejectedValue('unknown');

    await component.ngOnInit();

    expect(store.error()).toBe('errors.dashboard');
  });

  it('subscribes to onActivityUpdate on init and dispatches to store', async () => {
    const activityFrame$ = new Subject<{ onActivityUpdate: { activity: ActivityEntry } | null }>();
    mockService.subscribeToActivityUpdates = jest.fn(() => activityFrame$);
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1',
      username: 'user-1',
      email: 'user@example.com',
      tenantId: 'tenant-1',
      onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });
    const addSpy = jest.spyOn(store, 'addActivity');

    await component.ngOnInit();
    activityFrame$.next({
      onActivityUpdate: {
        activity: {
          activityId: 'evt-42',
          activityType: 'DEPOSIT_DETECTED',
          description: 'Deposit detected: 1000 USD',
          createdAt: '2026-05-28T12:48:03Z',
          metadata: null,
        },
      },
    });

    expect(mockService.subscribeToActivityUpdates).toHaveBeenCalledWith('tenant-1');
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ activityId: 'evt-42' }));
  });

  it('preserves a live activity frame that arrives during the initial load', async () => {
    const activityFrame$ = new Subject<{ onActivityUpdate: { activity: ActivityEntry } | null }>();
    mockService.subscribeToActivityUpdates = jest.fn(() => activityFrame$);

    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated({
      userId: 'user-1', username: 'user-1', email: 'user@example.com',
      tenantId: 'tenant-1', onboardingCompletedAt: '2026-01-01T00:00:00Z',
    });

    // getRecentActivity resolves AFTER we emit a live frame — simulating the
    // snapshot read completing later than a concurrently-arriving live event.
    let resolveActivity!: (v: ActivityEntry[]) => void;
    mockService.getRecentActivity = jest.fn(
      () => new Promise<ActivityEntry[]>((res) => { resolveActivity = res; }),
    );

    const init = component.ngOnInit();           // subscribe happens first now
    activityFrame$.next({                          // live frame during the load
      onActivityUpdate: {
        activity: {
          activityId: 'live-during-load',
          activityType: 'DEPOSIT_DETECTED',
          description: 'Deposit detected: 1000 USD',
          createdAt: '2026-05-28T12:48:03Z',
          metadata: null,
        },
      },
    });
    resolveActivity([]);                           // snapshot returns empty (row not yet visible)
    await init;

    expect(store.activities().map((a) => a.activityId)).toContain('live-during-load');
  });
});
