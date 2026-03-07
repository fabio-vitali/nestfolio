import { TestBed } from '@angular/core/testing';

const mockQuery = jest.fn();
jest.mock('@nestfolio/appsync-client', () => ({
  query: mockQuery,
  GET_DASHBOARD: 'GET_DASHBOARD',
  GET_POSITION_SNAPSHOTS: 'GET_POSITION_SNAPSHOTS',
  GET_RECENT_ACTIVITY: 'GET_RECENT_ACTIVITY',
}));

import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(DashboardService);
  });

  it('should call query with GET_DASHBOARD and return getDashboard', async () => {
    const mockData = { portfolioSummary: null, advisoryStatus: null, investorSnapshot: null };
    mockQuery.mockResolvedValue({ getDashboard: mockData });

    const result = await service.getDashboard();

    expect(mockQuery).toHaveBeenCalledWith('GET_DASHBOARD');
    expect(result).toEqual(mockData);
  });

  it('should call query with GET_POSITION_SNAPSHOTS and return array', async () => {
    const positions = [{ symbol: 'AAPL' }];
    mockQuery.mockResolvedValue({ getPositionSnapshots: positions });

    const result = await service.getPositionSnapshots();

    expect(mockQuery).toHaveBeenCalledWith('GET_POSITION_SNAPSHOTS');
    expect(result).toEqual(positions);
  });

  it('should call query with GET_RECENT_ACTIVITY without limit', async () => {
    const activities = [{ activityType: 'ORDER_FILLED' }];
    mockQuery.mockResolvedValue({ getRecentActivity: activities });

    const result = await service.getRecentActivity();

    expect(mockQuery).toHaveBeenCalledWith('GET_RECENT_ACTIVITY', undefined);
    expect(result).toEqual(activities);
  });

  it('should call query with GET_RECENT_ACTIVITY with limit', async () => {
    mockQuery.mockResolvedValue({ getRecentActivity: [] });

    await service.getRecentActivity(10);

    expect(mockQuery).toHaveBeenCalledWith('GET_RECENT_ACTIVITY', { limit: 10 });
  });
});
