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
        AdvisoryService,
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

  it('should call getPendingDecisions and return items', async () => {
    const items = [
      { decisionId: 'dec-001', status: 'AWAITING_CONFIRMATION', trigger: 'X', createdAt: 't1' },
      { decisionId: 'dec-002', status: 'COMPLIANCE_REVIEW', trigger: 'Y', createdAt: 't2' },
    ];
    graphql.query.mockResolvedValue({ getPendingDecisions: { items, nextCursor: null } });

    const result = await service.getPendingDecisions();

    expect(result).toEqual(items);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { limit: 20 });
  });

  it('should return [] when getPendingDecisions returns null connection', async () => {
    graphql.query.mockResolvedValue({ getPendingDecisions: null });

    const result = await service.getPendingDecisions();

    expect(result).toEqual([]);
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

  it('subscribeToDecisionUpdates passes tenantId as the GraphQL variable', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('t-abc', 'd-xyz', () => undefined);

    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: 't-abc' },
    );
  });

  it('should subscribe to decision updates', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());

    expect(graphql.subscribe).toHaveBeenCalledWith(expect.any(String), { tenantId: 't-001' });
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('should unsubscribe from decision updates', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());
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

    service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());
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

    service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());
    errorHandler(new Error('connection lost'));

    service.unsubscribeFromDecisionUpdates();
    jest.advanceTimersByTime(30_000);

    // Should not have reconnected
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  describe('subscribeToDecisionListUpdates', () => {
    it('subscribes with tenantId as the GraphQL variable', () => {
      const mockUnsubscribe = jest.fn();
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-abc', () => undefined);

      expect(graphql.subscribe).toHaveBeenCalledWith(expect.any(String), { tenantId: 't-abc' });
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('fires the callback for every frame (no decisionId filter)', () => {
      const cb = jest.fn();
      let nextHandler!: (data: { onDecisionUpdate: { decisionId: string; tenantId: string } }) => void;
      const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
        nextHandler = handlers.next;
        return { unsubscribe: jest.fn() };
      });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', cb);

      nextHandler({ onDecisionUpdate: { decisionId: 'a', tenantId: 't-001' } as any });
      nextHandler({ onDecisionUpdate: { decisionId: 'b', tenantId: 't-001' } as any });

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[0][0].decisionId).toBe('a');
      expect(cb.mock.calls[1][0].decisionId).toBe('b');
    });

    it('unsubscribes cleanly', () => {
      const mockUnsubscribe = jest.fn();
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', jest.fn());
      service.unsubscribeFromDecisionListUpdates();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('does not throw when unsubscribing without an active list subscription', () => {
      expect(() => service.unsubscribeFromDecisionListUpdates()).not.toThrow();
    });

    it('reconnects with backoff after a subscription error', () => {
      jest.useFakeTimers();
      let errorHandler!: (err: Error) => void;
      const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
        errorHandler = handlers.error;
        return { unsubscribe: jest.fn() };
      });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionListUpdates('t-001', jest.fn());
      expect(graphql.subscribe).toHaveBeenCalledTimes(1);

      errorHandler(new Error('connection lost'));
      jest.advanceTimersByTime(5000);
      expect(graphql.subscribe).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('list and detail subscriptions coexist independently', () => {
      const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: jest.fn() });
      graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

      service.subscribeToDecisionUpdates('t-001', 'dec-001', jest.fn());
      service.subscribeToDecisionListUpdates('t-001', jest.fn());

      // Two independent subscriptions on the same WSS channel.
      expect(graphql.subscribe).toHaveBeenCalledTimes(2);
    });
  });
});
