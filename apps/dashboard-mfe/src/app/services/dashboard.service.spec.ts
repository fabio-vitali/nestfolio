import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/appsync-client';
import { LogoutOrchestrator } from '@nestfolio/shared-state';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let graphql: jest.Mocked<GraphqlService>;
  let orchestrator: { register: jest.Mock; resetAll: jest.Mock };

  beforeEach(() => {
    graphql = {
      query: jest.fn(),
      mutate: jest.fn(),
      subscribe: jest.fn(),
      resetClient: jest.fn(),
    } as jest.Mocked<GraphqlService>;
    orchestrator = { register: jest.fn(), resetAll: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: GraphqlService, useValue: graphql },
        { provide: LogoutOrchestrator, useValue: orchestrator },
      ],
    });
    service = TestBed.inject(DashboardService);
  });

  it('should call query with GET_DASHBOARD and return getDashboard', async () => {
    const mockData = { portfolioSummary: null, advisoryStatus: null, investorSnapshot: null };
    graphql.query.mockResolvedValue({ getDashboard: mockData });

    const result = await service.getDashboard();

    expect(graphql.query).toHaveBeenCalledWith(expect.any(String));
    expect(result).toEqual(mockData);
  });

  it('should throw when getDashboard returns null', async () => {
    graphql.query.mockResolvedValue({ getDashboard: null });

    await expect(service.getDashboard()).rejects.toThrow('Dashboard data not found');
  });

  it('should call query with GET_POSITION_SNAPSHOTS and return array', async () => {
    const positions = [{ symbol: 'AAPL' }];
    graphql.query.mockResolvedValue({ getPositionSnapshots: positions });

    const result = await service.getPositionSnapshots();

    expect(result).toEqual(positions);
  });

  it('should call query with GET_RECENT_ACTIVITY without limit', async () => {
    const activities = [{ activityType: 'ORDER_FILLED' }];
    graphql.query.mockResolvedValue({ getRecentActivity: activities });

    const result = await service.getRecentActivity();

    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), undefined);
    expect(result).toEqual(activities);
  });

  it('should call query with GET_RECENT_ACTIVITY with limit', async () => {
    graphql.query.mockResolvedValue({ getRecentActivity: [] });

    await service.getRecentActivity(10);

    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { limit: 10 });
  });

  it('should return cached getDashboard on second call within TTL', async () => {
    const mockData = { portfolioSummary: null, advisoryStatus: null, investorSnapshot: null };
    graphql.query.mockResolvedValue({ getDashboard: mockData });

    await service.getDashboard();
    await service.getDashboard();

    // Only one query call for getDashboard (cached)
    expect(graphql.query).toHaveBeenCalledTimes(1);
  });

  it('should invalidate caches and refetch', async () => {
    const mockData = { portfolioSummary: null, advisoryStatus: null, investorSnapshot: null };
    graphql.query.mockResolvedValue({ getDashboard: mockData });

    await service.getDashboard();
    service.invalidateCaches();
    await service.getDashboard();

    expect(graphql.query).toHaveBeenCalledTimes(2);
  });

  it('should return simulation summary', async () => {
    const mockSim = {
      actualTotalValueCents: 10500000,
      simulatedTotalValueCents: 10800000,
      actualReturnPercent: 5.0,
      simulatedReturnPercent: 8.0,
      returnDifferencePercent: 3.0,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    graphql.query.mockResolvedValue({ getSimulationSummary: mockSim });

    const result = await service.getSimulationSummary();
    expect(result).toEqual(mockSim);
  });

  it('should return null when simulation summary is null', async () => {
    graphql.query.mockResolvedValue({ getSimulationSummary: null });

    const result = await service.getSimulationSummary();
    expect(result).toBeNull();
  });

  it('should register cache invalidation with LogoutOrchestrator', () => {
    expect(orchestrator.register).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should invalidate caches when orchestrator calls registered fn', async () => {
    const mockData = { portfolioSummary: null, advisoryStatus: null, investorSnapshot: null };
    graphql.query.mockResolvedValue({ getDashboard: mockData });

    await service.getDashboard();
    // Simulate logout — call the registered reset function
    const resetFn = orchestrator.register.mock.calls[0][0];
    resetFn();
    await service.getDashboard();

    expect(graphql.query).toHaveBeenCalledTimes(2);
  });
});
