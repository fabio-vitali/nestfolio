jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),

}));
import { type BusEvent, type UnitOfWork, logger } from '@nestfolio/event-processor';
import { DecisionPacketCreatedPipe } from '../src/pipes/decision-packet-created.pipe';

type Payload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

describe('DecisionPacketCreatedPipe', () => {
  const mockStoreDecision = jest.fn();

  const mockRepository = { storeDecision: mockStoreDecision } as any;

  let pipe: DecisionPacketCreatedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new DecisionPacketCreatedPipe(mockRepository);
  });

  it('should store decision on new DECISION_PACKET_CREATED event', async () => {
    mockStoreDecision.mockResolvedValue(true);

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

    await pipe.process(uow);

    expect(mockStoreDecision).toHaveBeenCalledWith('t1', 'd1', {
      trigger: 'REBALANCE',
      proposedTrades: [],
      explanation: 'Portfolio rebalance needed',
      confirmationRequired: true,
      complianceChecks: [],
      agentInvocations: [],
      sourceEventId: 'evt-1',
    });
    expect(logger.info).toHaveBeenCalledWith('Stored decision read model', {
      tenantId: 't1',
      decisionId: 'd1',
    });
  });

  it('should skip duplicate events when storeDecision returns false', async () => {
    mockStoreDecision.mockResolvedValue(false);

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

    await pipe.process(uow);

    expect(mockStoreDecision).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Decision already stored, skipping', {
      eventId: 'evt-dup',
      decisionId: 'd1',
    });
  });
});
