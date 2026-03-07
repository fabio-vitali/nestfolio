jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  IdempotencyGuard: jest.fn(),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import Highland from 'highland';
import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { DecisionPacketCreatedPipe } from '../pipes/decision-packet-created.pipe';

type Payload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

describe('DecisionPacketCreatedPipe', () => {
  const mockStoreDecision = jest.fn().mockResolvedValue(undefined);
  const mockEnsureOnce = jest.fn();

  const mockRepository = { storeDecision: mockStoreDecision } as any;
  const mockIdempotencyGuard = { ensureOnce: mockEnsureOnce } as any;

  let pipe: DecisionPacketCreatedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new DecisionPacketCreatedPipe(mockRepository, mockIdempotencyGuard);
  });

  it('should store decision on new DECISION_PACKET_CREATED event', (done) => {
    mockEnsureOnce.mockResolvedValue(true);

    const uow: UnitOfWork<BusEvent<Payload>> = {
      event: {
        id: 'evt-1',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          trigger: 'REBALANCE',
          proposedTrades: [],
          explanation: 'Portfolio rebalance needed',
          confirmationRequired: true,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    const source = Highland<UnitOfWork<BusEvent<Payload>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockEnsureOnce).toHaveBeenCalledWith('DECISION_PACKET_CREATED', 'evt-1');
      expect(mockStoreDecision).toHaveBeenCalledWith('t1', 'd1', {
        trigger: 'REBALANCE',
        proposedTrades: [],
        explanation: 'Portfolio rebalance needed',
        confirmationRequired: true,
        complianceChecks: [],
        agentInvocations: [],
      });
      done();
    });
  });

  it('should skip duplicate events', (done) => {
    mockEnsureOnce.mockResolvedValue(false);

    const uow: UnitOfWork<BusEvent<Payload>> = {
      event: {
        id: 'evt-dup',
        type: 'DECISION_PACKET_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          trigger: 'REBALANCE',
          proposedTrades: [],
          explanation: 'Portfolio rebalance needed',
          confirmationRequired: true,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    const source = Highland<UnitOfWork<BusEvent<Payload>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockEnsureOnce).toHaveBeenCalledWith('DECISION_PACKET_CREATED', 'evt-dup');
      expect(mockStoreDecision).not.toHaveBeenCalled();
      done();
    });
  });
});
