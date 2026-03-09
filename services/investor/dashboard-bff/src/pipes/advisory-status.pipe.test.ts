jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { AdvisoryStatusPipe } from './advisory-status.pipe';

describe('AdvisoryStatusPipe', () => {
  const mockUpsertAdvisoryStatus = jest.fn().mockResolvedValue({});

  const mockRepository = {
    upsertAdvisoryStatus: mockUpsertAdvisoryStatus,
  } as any;

  let pipe: AdvisoryStatusPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new AdvisoryStatusPipe(mockRepository);
  });

  it('should increment pending decisions on DECISION_PACKET_CREATED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2025-01-01T12:00:00.000Z',
        subject: { decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertAdvisoryStatus).toHaveBeenCalledWith('t1', {
      pendingDecisionsDelta: 1,
      lastRecommendationAt: '2025-01-01T12:00:00.000Z',
    });
  });

  it('should increment pending decisions on USER_CONFIRMATION_REQUESTED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'USER_CONFIRMATION_REQUESTED',
        timestamp: '2025-02-01T08:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertAdvisoryStatus).toHaveBeenCalledWith('t1', {
      pendingDecisionsDelta: 1,
      lastRecommendationAt: '2025-02-01T08:00:00.000Z',
    });
  });

  it('should decrement pending decisions and set status APPROVED on DECISION_APPROVED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-3',
        type: 'DECISION_APPROVED',
        timestamp: '2025-01-02T00:00:00.000Z',
        subject: { decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertAdvisoryStatus).toHaveBeenCalledWith('t1', {
      pendingDecisionsDelta: -1,
      lastDecisionStatus: 'APPROVED',
    });
  });

  it('should decrement pending decisions and set status BLOCKED on DECISION_BLOCKED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-4',
        type: 'DECISION_BLOCKED',
        timestamp: '2025-01-02T00:00:00.000Z',
        subject: { reason: 'compliance' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertAdvisoryStatus).toHaveBeenCalledWith('t1', {
      pendingDecisionsDelta: -1,
      lastDecisionStatus: 'BLOCKED',
    });
  });

  it('should not call upsertAdvisoryStatus for unknown event types', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-5',
        type: 'UNKNOWN_EVENT',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertAdvisoryStatus).not.toHaveBeenCalled();
  });
});
