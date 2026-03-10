import { TestBed } from '@angular/core/testing';
import { TimeTravelStore, LedgerPortfolio } from './time-travel.store';
import { LogoutOrchestrator } from '@nestfolio/shared-state';

describe('TimeTravelStore', () => {
  let store: InstanceType<typeof TimeTravelStore>;
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TimeTravelStore);
    orchestrator = TestBed.inject(LogoutOrchestrator);
    store.reset();
  });

  it('should have correct initial state', () => {
    expect(store.selectedDate()).toBeNull();
    expect(store.portfolio()).toBeNull();
    expect(store.available()).toBe(false);
    expect(store.oldestDate()).toBeNull();
    expect(store.latestDate()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should set availability', () => {
    store.setAvailability({
      available: true,
      oldestDate: '2025-01-01',
      latestDate: '2025-06-15',
    });

    expect(store.available()).toBe(true);
    expect(store.oldestDate()).toBe('2025-01-01');
    expect(store.latestDate()).toBe('2025-06-15');
  });

  it('should set selected date', () => {
    store.setSelectedDate('2025-03-15');
    expect(store.selectedDate()).toBe('2025-03-15');
    expect(store.isTimeTravel()).toBe(true);
  });

  it('should compute isTimeTravel based on selectedDate', () => {
    expect(store.isTimeTravel()).toBe(false);
    store.setSelectedDate('2025-01-01');
    expect(store.isTimeTravel()).toBe(true);
    store.setSelectedDate(null);
    expect(store.isTimeTravel()).toBe(false);
  });

  it('should set portfolio data', () => {
    const portfolio: LedgerPortfolio = {
      positions: [{ symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 255 }],
      cashBalanceCents: 7_500_000,
      totalValueCents: 10_050_000,
      positionCount: 1,
      snapshotAt: '2025-06-15T23:59:59.000Z',
      streamType: 'ACTUAL',
    };

    store.setPortfolio(portfolio);

    expect(store.portfolio()).toEqual(portfolio);
    expect(store.totalValueCents()).toBe(10_050_000);
    expect(store.positionCount()).toBe(1);
    expect(store.positions()).toHaveLength(1);
  });

  it('should compute dateRange when both dates are set', () => {
    expect(store.dateRange()).toBeNull();

    store.setAvailability({ available: true, oldestDate: '2025-01-01', latestDate: '2025-06-15' });

    expect(store.dateRange()).toEqual({ oldest: '2025-01-01', latest: '2025-06-15' });
  });

  it('should reset to initial state', () => {
    store.setAvailability({ available: true, oldestDate: '2025-01-01', latestDate: '2025-06-15' });
    store.setSelectedDate('2025-03-15');
    store.setPortfolio({
      positions: [],
      cashBalanceCents: 10_000_000,
      totalValueCents: 10_000_000,
      positionCount: 0,
      snapshotAt: '2025-03-15',
      streamType: 'ACTUAL',
    });

    store.reset();

    expect(store.selectedDate()).toBeNull();
    expect(store.portfolio()).toBeNull();
    expect(store.available()).toBe(false);
  });

  it('should reset on logout via orchestrator', () => {
    store.setAvailability({ available: true, oldestDate: '2025-01-01', latestDate: '2025-06-15' });
    store.setSelectedDate('2025-03-15');

    orchestrator.resetAll();

    expect(store.available()).toBe(false);
    expect(store.selectedDate()).toBeNull();
    expect(store.portfolio()).toBeNull();
  });

  it('should expose callState-based loading/error signals', () => {
    expect(store.loading()).toBe(false);
    expect(store.loaded()).toBe(false);
    expect(store.error()).toBeNull();

    store.setLoading(true);
    expect(store.loading()).toBe(true);

    store.setLoading(false);
    expect(store.loaded()).toBe(true);

    store.setError('fail');
    expect(store.error()).toBe('fail');
    expect(store.loading()).toBe(false);
  });
});
