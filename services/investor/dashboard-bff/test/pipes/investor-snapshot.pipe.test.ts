jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { InvestorSnapshotPipe } from '../../src/pipes/investor-snapshot.pipe';

describe('InvestorSnapshotPipe', () => {
  const mockUpsertInvestorSnapshot = jest.fn().mockResolvedValue({});

  const mockRepository = {
    upsertInvestorSnapshot: mockUpsertInvestorSnapshot,
  } as any;

  let pipe: InvestorSnapshotPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new InvestorSnapshotPipe(mockRepository);
  });

  it('should set all fields on ONBOARDING_COMPLETED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'ONBOARDING_COMPLETED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          operatingMode: 'AUTONOMOUS',
          riskScore: 7,
          goalId: 'RETIREMENT',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {
      operatingMode: 'AUTONOMOUS',
      riskLevel: '7',
      goalType: 'RETIREMENT',
      onboardedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('should update goalType on GOAL_SET', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'GOAL_SET',
        timestamp: '2025-01-02T00:00:00.000Z',
        subject: { objective: 'GROWTH' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {
      goalType: 'GROWTH',
    });
  });

  it('should update goalType on GOAL_UPDATED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-3',
        type: 'GOAL_UPDATED',
        timestamp: '2025-01-03T00:00:00.000Z',
        subject: { objective: 'INCOME' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {
      goalType: 'INCOME',
    });
  });

  it('should update riskLevel on RISK_PROFILE_SET', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-4',
        type: 'RISK_PROFILE_SET',
        timestamp: '2025-01-04T00:00:00.000Z',
        subject: { score: 5 },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {
      riskLevel: '5',
    });
  });

  it('should update riskLevel on RISK_PROFILE_UPDATED', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-5',
        type: 'RISK_PROFILE_UPDATED',
        timestamp: '2025-01-05T00:00:00.000Z',
        subject: { score: 3 },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {
      riskLevel: '3',
    });
  });

  it('should pass empty updates for unrecognized event types', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-6',
        type: 'UNKNOWN_EVENT',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { someField: 'value' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertInvestorSnapshot).toHaveBeenCalledWith('t1', {});
  });
});
