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
import { createHandlers, getNotificationTemplate, type EventListenerDeps } from '../src/handlers/event-listener';

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
      { type: 'MANDATE_GRANTED', expectedChannel: 'push' },
      { type: 'GOAL_UPDATED', expectedChannel: 'push' },
      { type: 'DEPOSIT_INITIATED', expectedChannel: 'push' },
      { type: 'OPERATING_MODE_CHANGED', expectedChannel: 'push' },
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
        fakeSqsRecord('MANDATE_GRANTED', {}, { tenantId: 'tenant-x', eventId: 'evt-x' }),
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

  describe('batch processing', () => {
    it('processes multiple records in a batch', async () => {
      const result = await harness.process([
        fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
        fakeSqsRecord('MANDATE_GRANTED', { userId: 'u2' }, { tenantId: 't2' }),
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
});
