import { TestBed } from '@angular/core/testing';
import {
  DashboardStore,
  PortfolioSummary,
  PositionSnapshot,
  ActivityEntry,
  AdvisoryStatus,
  DashboardData,
  SimulationSummary,
} from '../../../src/app/stores/dashboard.store';
import { LogoutOrchestrator } from '@nestfolio/shell';

describe('DashboardStore', () => {
  let store: InstanceType<typeof DashboardStore>;
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
    orchestrator = TestBed.inject(LogoutOrchestrator);
    store.reset();
  });

  const mockSummary: PortfolioSummary = {
    totalValueCents: 1000000,
    cashBalanceCents: 200000,
    positionCount: 5,
    driftPercent: 2.5,
    updatedAt: '2026-03-01T00:00:00Z',
  };

  const mockAdvisory: AdvisoryStatus = {
    pendingDecisionsCount: 3,
    lastRecommendationAt: '2026-03-01T00:00:00Z',
    lastDecisionStatus: 'APPROVED',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  const mockPositions: PositionSnapshot[] = [
    {
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      quantity: 10,
      avgCostBasisCents: 15000,
      currentPriceCents: 17500,
      marketValueCents: 175000,
      weightPercent: 40,
      unrealizedPnlCents: 25000,
      lastUpdatedAt: '2026-03-01T00:00:00Z',
    },
    {
      symbol: 'BND',
      assetClass: 'BOND',
      quantity: 20,
      avgCostBasisCents: 10000,
      currentPriceCents: 9500,
      marketValueCents: 190000,
      weightPercent: 45,
      unrealizedPnlCents: -10000,
      lastUpdatedAt: '2026-03-01T00:00:00Z',
    },
  ];

  const mockActivities: ActivityEntry[] = [
    {
      activityType: 'ORDER_FILLED',
      description: 'Bought 10 AAPL',
      createdAt: '2026-03-01T10:00:00Z',
      metadata: null,
    },
  ];

  const mockSimulationSummary: SimulationSummary = {
    actualTotalValueCents: 10500000,
    simulatedTotalValueCents: 10800000,
    actualReturnPercent: 5.0,
    simulatedReturnPercent: 8.0,
    returnDifferencePercent: 3.0,
    updatedAt: '2026-03-01T00:00:00Z',
  };

  it('should have correct initial state', () => {
    expect(store.portfolioSummary()).toBeNull();
    expect(store.advisoryStatus()).toBeNull();
    expect(store.investorSnapshot()).toBeNull();
    expect(store.positions()).toEqual([]);
    expect(store.activities()).toEqual([]);
    expect(store.simulationSummary()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should set dashboard data', () => {
    const data: DashboardData = {
      portfolioSummary: mockSummary,
      advisoryStatus: mockAdvisory,
      investorSnapshot: null,
    };
    store.setDashboard(data);

    expect(store.portfolioSummary()).toEqual(mockSummary);
    expect(store.advisoryStatus()).toEqual(mockAdvisory);
    expect(store.investorSnapshot()).toBeNull();
  });

  it('should set positions', () => {
    store.setPositions(mockPositions);
    expect(store.positions()).toEqual(mockPositions);
  });

  it('should set activities', () => {
    store.setActivities(mockActivities);
    expect(store.activities()).toEqual(mockActivities);
  });

  it('should set loading', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);
  });

  it('should set error', () => {
    store.setError('Network error');
    expect(store.error()).toBe('Network error');
  });

  it('should compute totalPnl', () => {
    store.setPositions(mockPositions);
    expect(store.totalPnl()).toBe(15000); // 25000 + (-10000)
  });

  it('should compute allocationByAssetClass', () => {
    store.setPositions(mockPositions);
    const allocation = store.allocationByAssetClass();
    expect(allocation['EQUITY']).toBe(40);
    expect(allocation['BOND']).toBe(45);
  });

  it('should group positions with null assetClass as OTHER', () => {
    store.setPositions([{ ...mockPositions[0], assetClass: null, weightPercent: 10 }]);
    expect(store.allocationByAssetClass()['OTHER']).toBe(10);
  });

  it('should compute hasAdvisoryAlerts', () => {
    expect(store.hasAdvisoryAlerts()).toBe(false);

    store.setDashboard({
      portfolioSummary: null,
      advisoryStatus: mockAdvisory,
      investorSnapshot: null,
    });
    expect(store.hasAdvisoryAlerts()).toBe(true);
  });

  it('should set and compute simulation summary', () => {
    expect(store.hasSimulationData()).toBe(false);
    expect(store.simulationAdvantagePercent()).toBe(0);

    store.setSimulationSummary(mockSimulationSummary);

    expect(store.simulationSummary()).toEqual(mockSimulationSummary);
    expect(store.hasSimulationData()).toBe(true);
    expect(store.simulationAdvantagePercent()).toBe(3.0);
  });

  it('should compute isLoaded', () => {
    expect(store.isLoaded()).toBe(false);

    store.setDashboard({
      portfolioSummary: mockSummary,
      advisoryStatus: null,
      investorSnapshot: null,
    });
    expect(store.isLoaded()).toBe(true);
  });

  it('should reset to initial state', () => {
    store.setLoading(true);
    store.setError('err');
    store.setPositions(mockPositions);
    store.reset();

    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.positions()).toEqual([]);
  });

  it('should reset on logout via orchestrator', () => {
    store.setLoading(true);
    store.setError('err');
    store.setPositions(mockPositions);

    orchestrator.resetAll();

    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.positions()).toEqual([]);
    expect(store.portfolioSummary()).toBeNull();
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
