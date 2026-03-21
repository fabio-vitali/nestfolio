import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { LogoutOrchestrator } from '@nestfolio/shell';
import { AdvisoryService } from '../../../src/app/services/advisory.service';

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

  it('should call confirmDecision', async () => {
    const updated = { decisionId: 'dec-001', status: 'CONFIRMED' };
    graphql.mutate.mockResolvedValue({ confirmDecision: updated });

    const result = await service.confirmDecision('dec-001');
    expect(result).toEqual(updated);
    expect(graphql.mutate).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001' });
  });

  it('should call rejectDecision', async () => {
    const updated = { decisionId: 'dec-001', status: 'REJECTED' };
    graphql.mutate.mockResolvedValue({ rejectDecision: updated });

    const result = await service.rejectDecision('dec-001', 'too risky');
    expect(result).toEqual(updated);
    expect(graphql.mutate).toHaveBeenCalledWith(expect.any(String), { decisionId: 'dec-001', reason: 'too risky' });
  });

  it('should invalidate caches after confirmDecision', async () => {
    graphql.query.mockResolvedValue({ getDecision: { decisionId: 'dec-001' } });
    graphql.mutate.mockResolvedValue({ confirmDecision: { decisionId: 'dec-001' } });

    await service.getDecision('dec-001');
    await service.confirmDecision('dec-001');
    await service.getDecision('dec-001');

    // Should have been called twice (invalidated after confirm)
    expect(graphql.query).toHaveBeenCalledTimes(2);
  });

  it('should invalidate caches after rejectDecision', async () => {
    graphql.query.mockResolvedValue({ getDecision: { decisionId: 'dec-001' } });
    graphql.mutate.mockResolvedValue({ rejectDecision: { decisionId: 'dec-001' } });

    await service.getDecision('dec-001');
    await service.rejectDecision('dec-001', 'reason');
    await service.getDecision('dec-001');

    expect(graphql.query).toHaveBeenCalledTimes(2);
  });

  it('should subscribe to decision updates', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('dec-001', jest.fn());

    expect(graphql.subscribe).toHaveBeenCalledWith(expect.any(String));
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('should unsubscribe from decision updates', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('dec-001', jest.fn());
    service.unsubscribeFromDecisionUpdates();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should not throw when unsubscribing without active subscription', () => {
    expect(() => service.unsubscribeFromDecisionUpdates()).not.toThrow();
  });

  it('should reconnect with backoff after subscription error', () => {
    jest.useFakeTimers();
    let errorHandler!: (err: Error) => void;
    const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
      errorHandler = handlers.error;
      return { unsubscribe: jest.fn() };
    });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('dec-001', jest.fn());
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);

    // First error → reconnect after 5s
    errorHandler(new Error('connection lost'));
    jest.advanceTimersByTime(5000);
    expect(graphql.subscribe).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('should clear reconnect timeout on unsubscribe', () => {
    jest.useFakeTimers();
    let errorHandler!: (err: Error) => void;
    const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
      errorHandler = handlers.error;
      return { unsubscribe: jest.fn() };
    });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('dec-001', jest.fn());
    errorHandler(new Error('connection lost'));

    service.unsubscribeFromDecisionUpdates();
    jest.advanceTimersByTime(30_000);

    // Should not have reconnected
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
