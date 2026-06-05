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
    updatedAt: '2026-03-01T00:00:00Z',
  };

  const mockAdvisory: AdvisoryStatus = {
    pendingDecisionsCount: 3,
    generatingCount: 0,
    failedCount: 0,
    oldestGeneratingAt: null,
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

  describe('advisory cycle derivation', () => {
    const FIXED_NOW = Date.parse('2026-06-05T12:00:00.000Z');
    const advisory = (over: Partial<AdvisoryStatus>): AdvisoryStatus => ({
      pendingDecisionsCount: 0, generatingCount: 0, failedCount: 0,
      oldestGeneratingAt: null, updatedAt: '2026-06-05T12:00:00Z', ...over,
    });

    it('advisoryGenerating is true for a fresh GENERATING row', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ generatingCount: 1, oldestGeneratingAt: '2026-06-05T11:59:00.000Z' }));
      expect(store.advisoryGenerating()).toBe(true);
      expect(store.advisoryFailed()).toBe(false);
    });

    it('advisoryFailed is true for a FAILED row with nothing pending/generating', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ failedCount: 1 }));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(true);
    });

    it('a stale GENERATING row (older than the ceiling) becomes failed', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ generatingCount: 1, oldestGeneratingAt: '2026-06-05T11:50:00.000Z' }));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(true);
    });

    it('pending decisions suppress the failed banner', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({ pendingDecisionsCount: 2, failedCount: 1 }));
      expect(store.advisoryFailed()).toBe(false);
      expect(store.advisoryGenerating()).toBe(false);
    });

    it('neither banner when idle', () => {
      store.setNow(FIXED_NOW);
      store.setAdvisoryStatus(advisory({}));
      expect(store.advisoryGenerating()).toBe(false);
      expect(store.advisoryFailed()).toBe(false);
    });
  });

  describe('live last-write-wins setters', () => {
    const summaryAt = (updatedAt: string, totalValueCents = 1): PortfolioSummary => ({
      totalValueCents, cashBalanceCents: 0, positionCount: 0, updatedAt,
    });
    const advisoryAt = (updatedAt: string, pendingDecisionsCount = 1): AdvisoryStatus => ({
      pendingDecisionsCount, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null, updatedAt,
    });

    it('setPortfolioSummary applies a newer frame', () => {
      store.setPortfolioSummary(summaryAt('2026-03-01T00:00:00Z', 100));
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setPortfolioSummary drops a strictly-older frame', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      store.setPortfolioSummary(summaryAt('2026-03-01T00:00:00Z', 100)); // older
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setPortfolioSummary never clobbers a live value with null', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200));
      store.setPortfolioSummary(null);
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });

    it('setAdvisoryStatus drops a strictly-older frame', () => {
      store.setAdvisoryStatus(advisoryAt('2026-03-02T00:00:00Z', 5));
      store.setAdvisoryStatus(advisoryAt('2026-03-01T00:00:00Z', 1)); // older
      expect(store.advisoryStatus()?.pendingDecisionsCount).toBe(5);
    });

    it('setDashboard does not clobber a newer live portfolioSummary with an older snapshot', () => {
      store.setPortfolioSummary(summaryAt('2026-03-02T00:00:00Z', 200)); // live frame
      store.setDashboard({
        portfolioSummary: summaryAt('2026-03-01T00:00:00Z', 100), // older backfill snapshot
        advisoryStatus: null,
        investorSnapshot: null,
      });
      expect(store.portfolioSummary()?.totalValueCents).toBe(200);
    });
  });
});

function entry(id: string, ts = '2026-05-28T00:00:00Z'): ActivityEntry {
  return {
    activityId: id,
    activityType: 'DEPOSIT_DETECTED',
    description: `Deposit ${id}`,
    createdAt: ts,
    metadata: null,
  };
}

describe('DashboardStore.mergeActivities', () => {
  let store: InstanceType<typeof DashboardStore>;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
    store.reset();
  });

  it('preserves a live row when a later query snapshot arrives (clobber regression)', () => {
    // Live frame lands first (subscription established before query returns)
    store.mergeActivities([entry('live', '2026-05-28T12:48:03Z')]);
    // Snapshot query returns WITHOUT the just-arrived live row (it committed after the read)
    store.mergeActivities([entry('snap', '2026-05-28T12:47:00Z')]);

    const ids = store.activities().map((a) => a.activityId);
    expect(ids).toContain('live'); // must NOT be clobbered
    expect(ids).toContain('snap');
    expect(ids).toEqual(['live', 'snap']); // newest createdAt first
  });

  it('is order-independent (query-then-live == live-then-query)', () => {
    store.mergeActivities([entry('a', '2026-05-28T10:00:00Z')]);
    store.mergeActivities([entry('b', '2026-05-28T11:00:00Z')]);
    const ab = store.activities().map((a) => a.activityId);

    store.reset();
    store.mergeActivities([entry('b', '2026-05-28T11:00:00Z')]);
    store.mergeActivities([entry('a', '2026-05-28T10:00:00Z')]);
    const ba = store.activities().map((a) => a.activityId);

    expect(ab).toEqual(ba);
    expect(ab).toEqual(['b', 'a']); // newest first regardless of arrival order
  });

  it('dedupes by activityId across merges', () => {
    store.mergeActivities([entry('x', '2026-05-28T10:00:00Z')]);
    store.mergeActivities([entry('x', '2026-05-28T10:00:00Z')]);
    expect(store.activities()).toHaveLength(1);
  });

  it('dedupes duplicate ids within a single incoming array', () => {
    store.mergeActivities([
      entry('x', '2026-05-28T10:00:00Z'),
      entry('x', '2026-05-28T10:00:00Z'),
    ]);
    expect(store.activities()).toHaveLength(1);
  });
});

describe('DashboardStore.addActivity', () => {
  let store: InstanceType<typeof DashboardStore>;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardStore);
  });

  it('prepends the new entry to activities', () => {
    store.setActivities([entry('a'), entry('b')]);
    store.addActivity(entry('c'));
    expect(store.activities().map((a) => a.activityId)).toEqual(['c', 'a', 'b']);
  });

  it('dedupes by activityId', () => {
    store.setActivities([entry('a')]);
    store.addActivity(entry('a'));
    expect(store.activities()).toHaveLength(1);
    expect(store.activities()[0].activityId).toBe('a');
  });

  it('caps the list at 50 entries', () => {
    store.setActivities(Array.from({ length: 50 }, (_, i) => entry(`a${i}`)));
    store.addActivity(entry('new'));
    expect(store.activities()).toHaveLength(50);
    expect(store.activities()[0].activityId).toBe('new');
    expect(store.activities().at(-1)?.activityId).toBe('a48'); // a49 dropped
  });
});
