const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutItem', input })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import {
  createHandlers,
  getNotificationTemplate,
  type EventListenerDeps,
} from '../../src/handlers/event-listener';


describe('investor-ctrl event-listener', () => {
  const mockDeps: EventListenerDeps = {};

  const harness = createTestHarness({
    serviceName: 'investor-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('getNotificationTemplate', () => {
    it('returns correct template for ONBOARDING_COMPLETED', () => {
      const t = getNotificationTemplate('ONBOARDING_COMPLETED');
      expect(t.title).toBe('Welcome to Nestfolio');
      expect(t.channel).toBe('email');
    });

    it('returns correct template for ORDER_FILLED', () => {
      const t = getNotificationTemplate('ORDER_FILLED');
      expect(t.title).toBe('Order Executed');
      expect(t.channel).toBe('email');
    });

    it('returns correct template for MANDATE_ISSUED', () => {
      const t = getNotificationTemplate('MANDATE_ISSUED');
      expect(t.title).toBe('Investment Mandate Activated');
      expect(t.channel).toBe('push');
    });

    it('returns correct template for MANDATE_REVOKED', () => {
      const t = getNotificationTemplate('MANDATE_REVOKED');
      expect(t.title).toBe('Mandate Revoked');
      expect(t.channel).toBe('push');
    });

    it('returns correct template for BROKER_CIRCUIT_OPEN', () => {
      const t = getNotificationTemplate('BROKER_CIRCUIT_OPEN');
      expect(t.title).toBe('Some features are temporarily paused');
      expect(t.channel).toBe('push');
    });

    it('returns correct template for BROKER_CIRCUIT_CLOSED', () => {
      const t = getNotificationTemplate('BROKER_CIRCUIT_CLOSED');
      expect(t.title).toBe('All features are available');
      expect(t.channel).toBe('push');
    });

    it('returns correct template for BROKER_HEAL_ESCALATED', () => {
      const t = getNotificationTemplate('BROKER_HEAL_ESCALATED');
      expect(t.title).toBe("We're looking into an issue");
      expect(t.channel).toBe('email,push');
    });

    it('returns fallback template for unknown event type', () => {
      const t = getNotificationTemplate('UNKNOWN_TYPE');
      expect(t.title).toBe('Notification');
      expect(t.body).toContain('UNKNOWN_TYPE');
      expect(t.channel).toBe('push');
    });
  });

  describe('WriteIntents — non-ORDER_FILLED events', () => {
    const testCases = [
      { type: 'ONBOARDING_COMPLETED', expectedChannel: 'email' },
      { type: 'MANDATE_ISSUED', expectedChannel: 'push' },
      { type: 'MANDATE_REVOKED', expectedChannel: 'push' },
      { type: 'DEPOSIT_INITIATED', expectedChannel: 'push' },
      { type: 'DECISION_APPROVED', expectedChannel: 'push' },
      { type: 'BALANCE_UPDATED', expectedChannel: 'push' },
    ];

    for (const { type, expectedChannel } of testCases) {
      it(`returns record('Notification') for ${type}`, async () => {
        const result = await harness.process([
          fakeSqsRecord(type, { userId: 'u1' }, { tenantId: 't1' }),
        ]);
        expect(result.errors).toHaveLength(0);
        expect(result.intents).toHaveLength(1);
        expect(result.intents[0]).toMatchObject({
          _tag: 'record',
          typename: 'Notification',
          fields: expect.objectContaining({
            __typename: 'Notification',
            status: 'DELIVERED',
            channel: expectedChannel,
            tenantId: 't1',
          }),
        });
      });
    }
  });

  describe('WriteIntents — relatedEntity derivation', () => {
    it('DECISION_APPROVED carries relatedEntityType=DECISION and decisionId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', { decisionId: 'dec-abc' }, { tenantId: 't1', eventId: 'evt-1' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          relatedEntityType: 'DECISION',
          relatedEntityId: 'dec-abc',
        }),
      });
    });

    it('DECISION_APPROVED falls back to eventId when decisionId absent', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {}, { tenantId: 't1', eventId: 'fallback-evt' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'DECISION',
          relatedEntityId: 'fallback-evt',
        }),
      });
    });

    it('DECISION_BLOCKED carries relatedEntityType=DECISION', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_BLOCKED', { decisionId: 'dec-xyz' }, { tenantId: 't1', eventId: 'evt-2' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'DECISION',
          relatedEntityId: 'dec-xyz',
        }),
      });
    });

    it('ORDER_FILLED carries relatedEntityType=ORDER and orderId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'ord-001' }, { tenantId: 't1', eventId: 'evt-3' }),
      ]);
      // ORDER_FILLED returns [Notification, MonthlyReport]; index 0 is Notification
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          relatedEntityType: 'ORDER',
          relatedEntityId: 'ord-001',
        }),
      });
    });

    it('DEPOSIT_INITIATED carries relatedEntityType=DEPOSIT and depositId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('DEPOSIT_INITIATED', { depositId: 'dep-001' }, { tenantId: 't1', eventId: 'evt-4' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'DEPOSIT',
          relatedEntityId: 'dep-001',
        }),
      });
    });

    it('WITHDRAWAL_SETTLED carries relatedEntityType=WITHDRAWAL and transferId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('WITHDRAWAL_SETTLED', { transferId: 'xfr-001' }, { tenantId: 't1', eventId: 'evt-5' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'WITHDRAWAL',
          relatedEntityId: 'xfr-001',
        }),
      });
    });

    it('MANDATE_ISSUED carries relatedEntityType=MANDATE and mandateId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', { mandateId: 'mnd-001' }, { tenantId: 't1', eventId: 'evt-6' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'MANDATE',
          relatedEntityId: 'mnd-001',
        }),
      });
    });

    it('BALANCE_UPDATED carries relatedEntityType=BALANCE and falls back to eventId', async () => {
      const result = await harness.process([
        fakeSqsRecord('BALANCE_UPDATED', {}, { tenantId: 't1', eventId: 'evt-bal' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'BALANCE',
          relatedEntityId: 'evt-bal',
        }),
      });
    });

    it('BROKER_CIRCUIT_OPEN carries relatedEntityType=SYSTEM and falls back to eventId', async () => {
      const result = await harness.process([
        fakeSqsRecord('BROKER_CIRCUIT_OPEN', {}, { tenantId: 'SYSTEM', eventId: 'evt-sys' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'SYSTEM',
          relatedEntityId: 'evt-sys',
        }),
      });
    });

    it('ONBOARDING_COMPLETED carries relatedEntityType=PROFILE and userId from subject', async () => {
      const result = await harness.process([
        fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'user-abc' }, { tenantId: 't1', eventId: 'evt-7' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        fields: expect.objectContaining({
          relatedEntityType: 'PROFILE',
          relatedEntityId: 'user-abc',
        }),
      });
    });
  });

  describe('WriteIntents — ORDER_FILLED', () => {
    it('returns [record(Notification), record(MonthlyReport)] for ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o1', symbol: 'AAPL' }, { tenantId: 't2' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Notification' });
      expect(result.intents[1]).toMatchObject({ _tag: 'record', typename: 'MonthlyReport' });
    });

    it('Notification for ORDER_FILLED has status DELIVERED and channel email', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't2' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          status: 'DELIVERED',
          channel: 'email',
          tenantId: 't2',
        }),
      });
    });

    it('MonthlyReport has correct fields for ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o2' }, { tenantId: 't3', eventId: 'evt-3' }),
      ]);
      expect(result.intents[1]).toMatchObject({
        _tag: 'record',
        typename: 'MonthlyReport',
        fields: expect.objectContaining({
          __typename: 'MonthlyReport',
          status: 'GENERATED',
          tenantId: 't3',
        }),
      });
      const reportFields = (result.intents[1] as { fields: Record<string, unknown> }).fields;
      expect(typeof reportFields['period']).toBe('string');
      expect((reportFields['period'] as string)).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('key layout', () => {
    it('Notification overrides pk to Notification#tenantId#notificationId', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', {}, { tenantId: 'tenant-x', eventId: 'evt-x' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        overrides: expect.objectContaining({
          pk: 'Notification#tenant-x#evt-x',
          sk: 'Notification',
        }),
      });
    });

    it('MonthlyReport overrides pk to MonthlyReport#tenantId#reportId', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {}, { tenantId: 'tenant-y', eventId: 'evt-y' }),
      ]);
      expect(result.intents[1]).toMatchObject({
        overrides: expect.objectContaining({
          pk: 'MonthlyReport#tenant-y#evt-y-report',
          sk: 'MonthlyReport',
        }),
      });
    });
  });

  describe('WriteIntents — ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_SETTLED', () => {
    it('should create notification for ORDER_REJECTED', async () => {
      const record = fakeSqsRecord('ORDER_REJECTED', {
        orderId: 'o1', reason: 'Safety check failed',
      }, { tenantId: 'tenant-1' });
      const result = await harness.process([record]);
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          title: 'Order Rejected',
          channel: 'push',
        }),
      });
    });

    it('should create notification for DECISION_BLOCKED', async () => {
      const record = fakeSqsRecord('DECISION_BLOCKED', {
        decisionId: 'd1', reason: 'Guardrail violation',
      }, { tenantId: 'tenant-1' });
      const result = await harness.process([record]);
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          title: 'Decision Blocked',
          channel: 'push',
        }),
      });
    });

    it('should create notification for WITHDRAWAL_SETTLED', async () => {
      const record = fakeSqsRecord('WITHDRAWAL_SETTLED', {
        withdrawalId: 'w1', amount: 500,
      }, { tenantId: 'tenant-1' });
      const result = await harness.process([record]);
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          title: 'Withdrawal Completed',
          channel: 'email',
        }),
      });
    });
  });

  describe('WriteIntents — circuit breaker (SYSTEM tenant)', () => {
    it('BROKER_CIRCUIT_OPEN creates Notification with tenantId=SYSTEM and push channel', async () => {
      const result = await harness.process([
        fakeSqsRecord('BROKER_CIRCUIT_OPEN', {}, { tenantId: 'SYSTEM', eventId: 'evt-cb-1' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          __typename: 'Notification',
          tenantId: 'SYSTEM',
          title: 'Some features are temporarily paused',
          channel: 'push',
          status: 'DELIVERED',
        }),
      });
    });

    it('BROKER_CIRCUIT_CLOSED creates Notification with tenantId=SYSTEM and correct title', async () => {
      const result = await harness.process([
        fakeSqsRecord('BROKER_CIRCUIT_CLOSED', {}, { tenantId: 'SYSTEM', eventId: 'evt-cb-2' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          tenantId: 'SYSTEM',
          title: 'All features are available',
          channel: 'push',
          status: 'DELIVERED',
        }),
      });
    });

    it('BROKER_HEAL_ESCALATED creates Notification with tenantId=SYSTEM and email+push channel', async () => {
      const result = await harness.process([
        fakeSqsRecord('BROKER_HEAL_ESCALATED', {}, { tenantId: 'SYSTEM', eventId: 'evt-cb-3' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          tenantId: 'SYSTEM',
          title: "We're looking into an issue",
          channel: 'email,push',
          status: 'DELIVERED',
        }),
      });
    });

    it('circuit breaker notifications key pk as Notification#SYSTEM#eventId', async () => {
      const result = await harness.process([
        fakeSqsRecord('BROKER_CIRCUIT_OPEN', {}, { tenantId: 'SYSTEM', eventId: 'evt-cb-key' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        overrides: expect.objectContaining({
          pk: 'Notification#SYSTEM#evt-cb-key',
          sk: 'Notification',
        }),
      });
    });
  });

  describe('batch processing', () => {
    it('processes multiple records in a batch', async () => {
      const result = await harness.process([
        fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
        fakeSqsRecord('MANDATE_ISSUED', { userId: 'u2' }, { tenantId: 't2' }),
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't3' }),
      ]);
      expect(result.metrics.EventProcessed).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('skips unknown event types', async () => {
      const result = await harness.process([
        fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
      ]);
      expect(result.skipped).toBe(1);
    });
  });

  describe('OPERATING_MODE_CHANGED handler', () => {
    it('fires one OPERATING_MODE_CHANGED notification for the tenant', async () => {
      const result = await harness.process([
        fakeSqsRecord(
          'OPERATING_MODE_CHANGED',
          { operatingMode: 'AGGRESSIVE' },
          { tenantId: 'tenant-omc', eventId: 'evt-omc' },
        ),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          type: 'OPERATING_MODE_CHANGED',
          title: 'Operating Mode Changed',
          tenantId: 'tenant-omc',
        }),
      });
    });
  });

  describe('GOAL_UPDATED handler', () => {
    it('fires one GOAL_UPDATED notification for the tenant', async () => {
      const result = await harness.process([
        fakeSqsRecord(
          'GOAL_UPDATED',
          { goal: { objective: 'INCOME' } },
          { tenantId: 'tenant-gu', eventId: 'evt-gu' },
        ),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          type: 'GOAL_UPDATED',
          title: 'Goal Updated',
          tenantId: 'tenant-gu',
        }),
      });
    });
  });
});
