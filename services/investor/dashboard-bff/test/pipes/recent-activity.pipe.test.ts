jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { RecentActivityPipe } from '../../src/pipes/recent-activity.pipe';

describe('RecentActivityPipe', () => {
  const mockAddActivity = jest.fn().mockResolvedValue({});

  const mockRepository = {
    addActivity: mockAddActivity,
  } as any;

  let pipe: RecentActivityPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new RecentActivityPipe(mockRepository);
  });

  it('should produce description for ORDER_FILLED event using symbol', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { orderId: 'o1', symbol: 'AAPL' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddActivity).toHaveBeenCalledWith('t1', {
      activityType: 'ORDER_FILLED',
      description: 'Order filled: AAPL',
      metadata: { orderId: 'o1', symbol: 'AAPL' },
    });
  });

  it('should produce description for DECISION_APPROVED event', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'DECISION_APPROVED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddActivity).toHaveBeenCalledWith('t1', {
      activityType: 'DECISION_APPROVED',
      description: 'Decision approved: d1',
      metadata: { decisionId: 'd1' },
    });
  });

  it('should produce description for DEPOSIT_DETECTED event with amount', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-3',
        type: 'DEPOSIT_DETECTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { amountCents: 50000, currency: 'EUR' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddActivity).toHaveBeenCalledWith('t1', {
      activityType: 'DEPOSIT_DETECTED',
      description: 'Deposit detected: 500 EUR',
      metadata: { amountCents: 50000, currency: 'EUR' },
    });
  });

  it('should produce generic description for unknown event types', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-4',
        type: 'SOME_UNKNOWN_EVENT',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { foo: 'bar' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddActivity).toHaveBeenCalledWith('t1', {
      activityType: 'SOME_UNKNOWN_EVENT',
      description: expect.stringContaining('SOME_UNKNOWN_EVENT'),
      metadata: { foo: 'bar' },
    });
  });

  it('should produce description for DECISION_BLOCKED event with reason', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-5',
        type: 'DECISION_BLOCKED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { reason: 'compliance violation', decisionId: 'd2' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddActivity).toHaveBeenCalledWith('t1', {
      activityType: 'DECISION_BLOCKED',
      description: 'Decision blocked: compliance violation',
      metadata: { reason: 'compliance violation', decisionId: 'd2' },
    });
  });
});
