import { TestBed } from '@angular/core/testing';
import { throwError, Subject } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { createMockGraphqlService } from '@nestfolio/shell/testing';
import {
  DepositService,
  type DepositIntent,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';

describe('DepositService', () => {
  let graphql: ReturnType<typeof createMockGraphqlService>;
  let service: DepositService;

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

  it('initiateDeposit: calls the InitiateDeposit mutation with amountCents + currency and returns the intent', async () => {
    const intent: DepositIntent = {
      depositId: 'dep-1',
      amountCents: 10_000,
      currency: 'USD',
      status: 'INITIATED',
      initiatedAt: '2026-04-22T00:00:00.000Z',
    };
    graphql.mutate.mockResolvedValue({ initiateDeposit: intent });

    const out = await service.initiateDeposit({ amountCents: 10_000, currency: 'USD' });

    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('initiateDeposit'),
      { input: { amountCents: 10_000, currency: 'USD' } },
    );
    expect(out).toEqual(intent);
  });

  it('initiateDeposit: propagates mutation errors (e.g. feature-flag disabled)', async () => {
    graphql.mutate.mockRejectedValue(new Error('This action is temporarily paused'));
    await expect(service.initiateDeposit({ amountCents: 1_000, currency: 'USD' }))
      .rejects.toThrow('This action is temporarily paused');
  });

  it('subscribeToDepositEvent: forwards subscription payloads to the callback', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());

    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent('dep-1', (e) => received.push(e));

    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('onDepositEvent'),
      { depositId: 'dep-1' },
    );

    const payload: DepositEvent = {
      depositId: 'dep-1',
      tenantId: 't-1',
      status: 'DETECTED',
      amountCents: 10_000,
      currency: 'USD',
      occurredAt: '2026-04-22T00:00:00.000Z',
      reason: null,
    };
    subject.next({ onDepositEvent: payload });
    expect(received).toEqual([payload]);
  });

  it('unsubscribeFromDepositEvent: unsubscribes and ignores further payloads', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());

    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent('dep-1', (e) => received.push(e));
    service.unsubscribeFromDepositEvent();

    subject.next({
      onDepositEvent: {
        depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
        amountCents: 1, currency: 'USD', occurredAt: '', reason: null,
      },
    });
    expect(received).toEqual([]);
  });

  it('subscribeToDepositEvent: on subscription error, still records error via console but does not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    graphql.subscribe.mockReturnValue(throwError(() => new Error('WS closed')));

    expect(() => service.subscribeToDepositEvent('dep-1', () => undefined)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
