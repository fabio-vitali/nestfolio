import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { createMockGraphqlService } from '@nestfolio/shell/testing';
import { GoLiveService } from '../../../src/app/services/go-live.service';

describe('GoLiveService', () => {
  let graphql: ReturnType<typeof createMockGraphqlService>;
  let svc: GoLiveService;

  beforeEach(() => {
    graphql = createMockGraphqlService();
    TestBed.configureTestingModule({
      providers: [
        GoLiveService,
        { provide: GraphqlService, useValue: graphql },
      ],
    });
    svc = TestBed.inject(GoLiveService);
  });

  it('getProfile: calls query with getProfile document and returns the profile', async () => {
    graphql.query.mockResolvedValue({ getProfile: { executionMode: 'simulation' } });
    const p = await svc.getProfile();
    expect(graphql.query).toHaveBeenCalledWith(
      expect.stringContaining('getProfile'),
      expect.anything(),
    );
    expect(p.executionMode).toBe('simulation');
  });

  it('confirmGoLive: calls mutate with confirmGoLive document and returns the updated profile', async () => {
    graphql.mutate.mockResolvedValue({ confirmGoLive: { executionMode: 'live' } });
    const p = await svc.confirmGoLive();
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('confirmGoLive'),
      expect.anything(),
    );
    expect(p.executionMode).toBe('live');
  });

  it('updateRiskProfile: calls mutate with toleranceIdx and experienceIdx', async () => {
    graphql.mutate.mockResolvedValue({ updateRiskProfile: { riskProfile: { score: 7 } } });
    const p = await svc.updateRiskProfile(2, 3);
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('updateRiskProfile'),
      { toleranceIdx: 2, experienceIdx: 3 },
    );
    expect(p.riskProfile.score).toBe(7);
  });

  it('updateGoal: calls mutate with goal input', async () => {
    const goalInput = { objective: 'RETIREMENT', targetAmountCents: 100_000_00, currency: 'USD', timeHorizonMonths: 120, targetReturn: 0.07 };
    graphql.mutate.mockResolvedValue({ updateGoal: { objective: 'RETIREMENT' } });
    const p = await svc.updateGoal(goalInput);
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('updateGoal'),
      { input: goalInput },
    );
    expect(p.objective).toBe('RETIREMENT');
  });

  it('updateOperatingMode: calls mutate with mode', async () => {
    graphql.mutate.mockResolvedValue({ updateOperatingMode: { operatingMode: 'BALANCED' } });
    const p = await svc.updateOperatingMode('BALANCED');
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('updateOperatingMode'),
      { mode: 'BALANCED' },
    );
    expect(p.operatingMode).toBe('BALANCED');
  });
});
