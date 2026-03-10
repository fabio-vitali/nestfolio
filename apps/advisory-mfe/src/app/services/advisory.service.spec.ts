import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/appsync-client';
import { LogoutOrchestrator } from '@nestfolio/shared-state';
import { AdvisoryService } from './advisory.service';

describe('AdvisoryService', () => {
  let service: AdvisoryService;
  let graphql: jest.Mocked<GraphqlService>;
  let orchestrator: { register: jest.Mock; resetAll: jest.Mock };

  beforeEach(() => {
    graphql = { query: jest.fn(), mutate: jest.fn(), subscribe: jest.fn(), resetClient: jest.fn() } as any;
    orchestrator = { register: jest.fn(), resetAll: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: GraphqlService, useValue: graphql },
        { provide: LogoutOrchestrator, useValue: orchestrator },
      ],
    });
    service = TestBed.inject(AdvisoryService);
  });

  it('should call getDecision', async () => {
    const decision = { decisionId: 'dec-001', status: 'APPROVED' };
    graphql.query.mockResolvedValue({ getDecision: decision });

    const result = await service.getDecision('dec-001');
    expect(result).toEqual(decision);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001' });
  });

  it('should throw when getDecision returns null', async () => {
    graphql.query.mockResolvedValue({ getDecision: null });

    await expect(service.getDecision('dec-001')).rejects.toThrow('Decision not found');
  });

  it('should call getAgentInvocations', async () => {
    const invocations = [{ invocationId: 'inv-001' }];
    graphql.query.mockResolvedValue({ getAgentInvocations: invocations });

    const result = await service.getAgentInvocations('dec-001');
    expect(result).toEqual(invocations);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001' });
  });

  it('should call getComplianceChecks', async () => {
    const checks = [{ checkId: 'chk-001' }];
    graphql.query.mockResolvedValue({ getComplianceChecks: checks });

    const result = await service.getComplianceChecks('dec-001');
    expect(result).toEqual(checks);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001' });
  });

  it('should call recordExplanationView', async () => {
    graphql.mutate.mockResolvedValue({});

    await service.recordExplanationView('dec-001');
    expect(graphql.mutate).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001' });
  });

  it('should return cached getDecision on second call within TTL', async () => {
    const decision = { decisionId: 'dec-001', status: 'APPROVED' };
    graphql.query.mockResolvedValue({ getDecision: decision });

    await service.getDecision('dec-001');
    await service.getDecision('dec-001');

    expect(graphql.query).toHaveBeenCalledTimes(1);
  });

  it('should invalidate caches and refetch', async () => {
    const decision = { decisionId: 'dec-001', status: 'APPROVED' };
    graphql.query.mockResolvedValue({ getDecision: decision });

    await service.getDecision('dec-001');
    service.invalidateCaches();
    await service.getDecision('dec-001');

    expect(graphql.query).toHaveBeenCalledTimes(2);
  });

  it('should register cache invalidation with LogoutOrchestrator', () => {
    expect(orchestrator.register).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should recreate caches when decisionId changes', async () => {
    graphql.query.mockResolvedValueOnce({ getDecision: { decisionId: 'dec-001' } });
    graphql.query.mockResolvedValueOnce({ getDecision: { decisionId: 'dec-002' } });

    await service.getDecision('dec-001');
    await service.getDecision('dec-002');

    expect(graphql.query).toHaveBeenCalledTimes(2);
  });
});
