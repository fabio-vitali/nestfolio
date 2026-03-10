import { TestBed } from '@angular/core/testing';
import { DashboardContainerComponent } from './dashboard-container.component';
import { DashboardStore } from '../stores/dashboard.store';
import { DashboardService } from '../services/dashboard.service';
import { I18nService } from '@nestfolio/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shared-state/testing';

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
});
