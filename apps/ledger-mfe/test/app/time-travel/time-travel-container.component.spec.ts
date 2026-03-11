import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { I18nService } from '@nestfolio/i18n';
import { setupComponentTest, createMockI18nService } from '@nestfolio/shared-state/testing';
import { TimeTravelContainerComponent } from '../../../src/app/time-travel/time-travel-container.component';
import { TimeTravelService } from '../../../src/app/services/time-travel.service';
import { TimeTravelStore } from '../../../src/app/stores/time-travel.store';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('TimeTravelContainerComponent', () => {
  let component: TimeTravelContainerComponent;
  let store: InstanceType<typeof TimeTravelStore>;
  let mockService: jest.Mocked<TimeTravelService>;
  let mockRouter: { navigate: jest.Mock };

  beforeEach(async () => {
    mockService = {
      getAvailability: jest.fn().mockResolvedValue({
        available: true,
        oldestDate: '2025-01-01',
        latestDate: '2025-06-15',
      }),
      getPortfolioAt: jest.fn().mockResolvedValue({
        positions: [],
        cashBalanceCents: 10_000_000,
        totalValueCents: 10_000_000,
        positionCount: 0,
        snapshotAt: '2025-06-15T23:59:59.000Z',
        streamType: 'ACTUAL',
      }),
    } as jest.Mocked<TimeTravelService>;

    mockRouter = { navigate: jest.fn() };

    const fixture = await setupComponentTest(TimeTravelContainerComponent, {
      providers: [
        { provide: TimeTravelService, useValue: mockService },
        { provide: Router, useValue: mockRouter },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });

    store = TestBed.inject(TimeTravelStore);
    store.reset();
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadAvailability on init', async () => {
    component.ngOnInit();
    await flushPromises();

    expect(mockService.getAvailability).toHaveBeenCalled();
    expect(store.available()).toBe(true);
    expect(store.oldestDate()).toBe('2025-01-01');
    expect(store.latestDate()).toBe('2025-06-15');
  });

  it('should render unavailable when availability is false', async () => {
    mockService.getAvailability.mockResolvedValue({
      available: false,
      oldestDate: null,
      latestDate: null,
    });

    component.ngOnInit();
    await flushPromises();

    expect(store.available()).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('should call getPortfolioAt on date selection', async () => {
    await component.onDateSelected('2025-03-15');

    expect(mockService.getPortfolioAt).toHaveBeenCalledWith(
      'ACTUAL',
      '2025-03-15T23:59:59.000Z',
    );
    expect(store.portfolio()).toBeTruthy();
    expect(store.loading()).toBe(false);
  });

  it('should set error on getPortfolioAt failure', async () => {
    mockService.getPortfolioAt.mockRejectedValue(new Error('Network error'));

    await component.onDateSelected('2025-03-15');

    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBe(false);
  });

  it('should set error on loadAvailability failure', async () => {
    mockService.getAvailability.mockRejectedValue(new Error('fail'));

    component.ngOnInit();
    await flushPromises();

    expect(store.error()).toBeTruthy();
  });

  it('should navigate to dashboard on backToNow', () => {
    component.backToNow();

    expect(store.available()).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
