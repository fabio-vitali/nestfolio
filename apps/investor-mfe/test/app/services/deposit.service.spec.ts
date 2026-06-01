import { TestBed } from '@angular/core/testing';
import { throwError, Subject } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { createMockGraphqlService } from '@nestfolio/shell/testing';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';

describe('DepositService', () => {
  let graphql: ReturnType<typeof createMockGraphqlService>;
  let service: DepositService;

  const depositId = '33333333-3333-4333-8333-333333333333';
  const deposit: Deposit = {
    depositId,
    amountCents: 10_000,
    currency: 'USD',
    status: 'INITIATED',
    initiatedAt: '2026-04-22T00:00:00.000Z',
    detectedAt: null,
    failedAt: null,
    reason: null,
  };

  beforeEach(() => {
    graphql = createMockGraphqlService();
    TestBed.configureTestingModule({
      providers: [
        DepositService,
        { provide: GraphqlService, useValue: graphql },
      ],
    });
    service = TestBed.inject(DepositService);
  });

  it('initiateDeposit: passes depositId, amountCents, currency to the mutation and returns Deposit', async () => {
    graphql.mutate.mockResolvedValue({ initiateDeposit: deposit });
    const out = await service.initiateDeposit({ depositId, amountCents: 10_000, currency: 'USD' });
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('initiateDeposit'),
      { input: { depositId, amountCents: 10_000, currency: 'USD' } },
    );
    expect(out).toEqual(deposit);
  });

  it('initiateDeposit: propagates mutation errors', async () => {
    graphql.mutate.mockRejectedValue(new Error('This action is temporarily paused'));
    await expect(service.initiateDeposit({ depositId, amountCents: 1_000, currency: 'USD' }))
      .rejects.toThrow('This action is temporarily paused');
  });

  it('getDeposit: queries with depositId and returns the row', async () => {
    graphql.query.mockResolvedValue({ getDeposit: deposit });
    const out = await service.getDeposit(depositId);
    expect(graphql.query).toHaveBeenCalledWith(
      expect.stringContaining('getDeposit'),
      { depositId },
    );
    expect(out).toEqual(deposit);
  });

  it('getDeposit: throws DepositNotFoundError on AppSync NotFoundError', async () => {
    const err: Error & { errorType?: string } = new Error('Deposit not found');
    err.errorType = 'NotFoundError';
    graphql.query.mockRejectedValue(err);
    await expect(service.getDeposit(depositId)).rejects.toBeInstanceOf(DepositNotFoundError);
  });

  it('getDeposit: rethrows non-NotFound errors as-is', async () => {
    graphql.query.mockRejectedValue(new Error('Connection refused'));
    await expect(service.getDeposit(depositId)).rejects.toThrow('Connection refused');
  });

  it('subscribeToDepositEvent: subscribes to onDepositUpdate and maps payload → DepositEvent', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('onDepositUpdate'),
      { depositId },
    );
    subject.next({
      onDepositUpdate: {
        depositId, status: 'DETECTED', amountCents: 10_000, currency: 'USD',
        detectedAt: '2026-04-22T00:01:00.000Z', settledAt: null, failedAt: null, reason: null,
      },
    });
    expect(received).toEqual([{
      depositId, status: 'DETECTED', amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    }]);
  });

  it('subscribeToDepositEvent: maps SETTLED (settledAt) → occurredAt when detectedAt is absent', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    subject.next({
      onDepositUpdate: {
        depositId, status: 'SETTLED', amountCents: 10_000, currency: 'USD',
        detectedAt: null, settledAt: '2026-04-22T00:02:00.000Z', failedAt: null, reason: null,
      },
    });
    expect(received[0]).toMatchObject({ status: 'SETTLED', occurredAt: '2026-04-22T00:02:00.000Z' });
  });

  it('unsubscribeFromDepositEvent: ignores further payloads', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    service.unsubscribeFromDepositEvent();
    subject.next({
      onDepositUpdate: {
        depositId, status: 'DETECTED', amountCents: 1, currency: 'USD',
        detectedAt: '2026-04-22T00:01:00.000Z', settledAt: null, failedAt: null, reason: null,
      },
    });
    expect(received).toEqual([]);
  });

  it('subscribeToDepositEvent: error path logs but does not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    graphql.subscribe.mockReturnValue(throwError(() => new Error('WS closed')));
    expect(() => service.subscribeToDepositEvent(depositId, () => undefined)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('waitForSubscriptionReady: resolves after an internal handshake delay', async () => {
    jest.useFakeTimers();
    try {
      const promise = service.waitForSubscriptionReady();
      jest.advanceTimersByTime(500);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
