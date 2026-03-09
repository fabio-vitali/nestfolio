jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { DecisionStatusChangedPipe } from '../pipes/decision-status-changed.pipe';

type Payload = {
  tenantId: string;
  decisionId: string;
  [key: string]: unknown;
};

describe('DecisionStatusChangedPipe', () => {
  const mockUpdateDecisionStatus = jest.fn().mockResolvedValue(undefined);

  const mockRepository = { updateDecisionStatus: mockUpdateDecisionStatus } as any;

  let pipe: DecisionStatusChangedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new DecisionStatusChangedPipe(mockRepository);
  });

  it('should update status to APPROVED on DECISION_APPROVED', async () => {
    const uow: UnitOfWork<BusEvent<Payload>> = {
      event: {
        id: 'evt-1',
        type: 'DECISION_APPROVED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpdateDecisionStatus).toHaveBeenCalledWith('t1', 'd1', 'APPROVED');
  });

  it('should update status to BLOCKED on DECISION_BLOCKED', async () => {
    const uow: UnitOfWork<BusEvent<Payload>> = {
      event: {
        id: 'evt-2',
        type: 'DECISION_BLOCKED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpdateDecisionStatus).toHaveBeenCalledWith('t1', 'd1', 'BLOCKED');
  });

  it('should update status to AWAITING_CONFIRMATION on USER_CONFIRMATION_REQUESTED', async () => {
    const uow: UnitOfWork<BusEvent<Payload>> = {
      event: {
        id: 'evt-3',
        type: 'USER_CONFIRMATION_REQUESTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', decisionId: 'd1' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpdateDecisionStatus).toHaveBeenCalledWith('t1', 'd1', 'AWAITING_CONFIRMATION');
  });
});
