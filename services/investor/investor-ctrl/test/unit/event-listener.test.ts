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
import { ZodError } from 'zod';

// ── Valid fixture builders ───────────────────────────────────────────────────
// Each helper returns a minimal-valid subject conforming to the producer's schema.

/** ComplianceCheckSchema — required by DECISION_APPROVED / DECISION_BLOCKED */
function complianceCheckSubject(overrides: { decisionId?: string } = {}) {
  return {
    ccId: 'cc-001',
    decisionPacketId: 'dp-001',
    decisionId: overrides.decisionId ?? 'dec-001',
    taskToken: 'token-001',
    mandateSnapshot: {
      level: 'ADVISORY' as const,
      status: 'ACTIVE' as const,
      operatingMode: 'BALANCED' as const,
      effectiveDate: '2026-01-01',
    },
    status: 'COMPLETED' as const,
    result: 'APPROVED' as const,
    violations: [],
    authorityLevel: 'L1' as const,
    sourceEventId: 'src-evt-001',
  };
}

/** NormalizedOrderEventSchema — required by ORDER_FILLED / ORDER_REJECTED */
function normalizedOrderSubject(overrides: { orderId?: string } = {}) {
  return {
    orderId: overrides.orderId ?? 'ord-001',
    executionMode: 'simulation' as const,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

/** FundingSnapshotSchema — required by WITHDRAWAL_SETTLED */
function fundingSnapshotSubject(overrides: { transferId?: string } = {}) {
  return {
    sk: 'WITHDRAWAL_SETTLED',
    direction: 'WITHDRAWAL' as const,
    status: 'settled' as const,
    transferId: overrides.transferId ?? 'xfr-001',
    amountCents: 10000,
    currency: 'USD',
    executionMode: 'simulation' as const,
    initiatedAt: '2026-01-01T00:00:00.000Z',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

/** DepositInitiatedSchema — required by DEPOSIT_INITIATED */
function depositInitiatedSubject(overrides: { depositId?: string } = {}) {
  return {
    depositId: overrides.depositId ?? 'dep-001',
    amountCents: 5000,
    currency: 'USD',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

/** MandateSchema — required by MANDATE_ISSUED / MANDATE_REVOKED */
function mandateSubject(overrides: { mandateId?: string } = {}) {
  return {
    mandateId: overrides.mandateId ?? 'mnd-001',
    level: 'ADVISORY' as const,
    status: 'ACTIVE' as const,
    operatingMode: 'BALANCED' as const,
    effectiveDate: '2026-01-01',
  };
}

/** BalanceUpdatedSchema — required by BALANCE_UPDATED */
function balanceUpdatedSubject() {
  return {
    cashBalanceCents: 100000,
    snapshot: {
      positions: {},
      cashBalanceCents: 100000,
      lastEventSequence: 1,
    },
  };
}


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
    // Each test case pairs the event type with its required subject fixture and expected channel.
    // Fixtures conform to the producer schema for each event type.
    const testCases: Array<{ type: string; subject: Record<string, unknown>; expectedChannel: string }> = [
      { type: 'ONBOARDING_COMPLETED', subject: {}, expectedChannel: 'email' },
      { type: 'MANDATE_ISSUED', subject: mandateSubject(), expectedChannel: 'push' },
      { type: 'MANDATE_REVOKED', subject: mandateSubject({ mandateId: 'mnd-rev' }), expectedChannel: 'push' },
      { type: 'DEPOSIT_INITIATED', subject: depositInitiatedSubject(), expectedChannel: 'push' },
      { type: 'DECISION_APPROVED', subject: complianceCheckSubject(), expectedChannel: 'push' },
      { type: 'BALANCE_UPDATED', subject: balanceUpdatedSubject(), expectedChannel: 'push' },
    ];

    for (const { type, subject, expectedChannel } of testCases) {
      it(`returns record('Notification') for ${type}`, async () => {
        const result = await harness.process([
          fakeSqsRecord(type, subject, { tenantId: 't1' }),
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
        fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject({ decisionId: 'dec-abc' }), { tenantId: 't1', eventId: 'evt-1' }),
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

    it('DECISION_BLOCKED carries relatedEntityType=DECISION', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_BLOCKED', complianceCheckSubject({ decisionId: 'dec-xyz' }), { tenantId: 't1', eventId: 'evt-2' }),
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
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject({ orderId: 'ord-001' }), { tenantId: 't1', eventId: 'evt-3' }),
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
        fakeSqsRecord('DEPOSIT_INITIATED', depositInitiatedSubject({ depositId: 'dep-001' }), { tenantId: 't1', eventId: 'evt-4' }),
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
        fakeSqsRecord('WITHDRAWAL_SETTLED', fundingSnapshotSubject({ transferId: 'xfr-001' }), { tenantId: 't1', eventId: 'evt-5' }),
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
        fakeSqsRecord('MANDATE_ISSUED', mandateSubject({ mandateId: 'mnd-001' }), { tenantId: 't1', eventId: 'evt-6' }),
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
        fakeSqsRecord('BALANCE_UPDATED', balanceUpdatedSubject(), { tenantId: 't1', eventId: 'evt-bal' }),
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

    it('ONBOARDING_COMPLETED carries relatedEntityType=PROFILE and userId from context (not subject)', async () => {
      const result = await harness.process([
        fakeSqsRecord('ONBOARDING_COMPLETED', {}, { tenantId: 't1', eventId: 'evt-7', userId: 'user-abc' }),
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
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject({ orderId: 'o1' }), { tenantId: 't2' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Notification' });
      expect(result.intents[1]).toMatchObject({ _tag: 'record', typename: 'MonthlyReport' });
    });

    it('Notification for ORDER_FILLED has status DELIVERED and channel email', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject({ orderId: 'o1' }), { tenantId: 't2' }),
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
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject({ orderId: 'o2' }), { tenantId: 't3', eventId: 'evt-3' }),
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

    it('MonthlyReport orderDetails is the typed NormalizedOrderEvent (no untyped cast)', async () => {
      const subject = normalizedOrderSubject({ orderId: 'o-typed' });
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', subject, { tenantId: 't4', eventId: 'evt-typed' }),
      ]);
      const reportFields = (result.intents[1] as { fields: Record<string, unknown> }).fields;
      // orderDetails is the typed parsed subject — orderId is present
      expect((reportFields['orderDetails'] as Record<string, unknown>)['orderId']).toBe('o-typed');
    });
  });

  describe('key layout', () => {
    it('Notification overrides pk to Notification#tenantId#notificationId', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', mandateSubject(), { tenantId: 'tenant-x', eventId: 'evt-x' }),
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
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject(), { tenantId: 'tenant-y', eventId: 'evt-y' }),
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
      const sqsRecord = fakeSqsRecord('ORDER_REJECTED', normalizedOrderSubject({ orderId: 'o1' }), { tenantId: 'tenant-1' });
      const result = await harness.process([sqsRecord]);
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          title: 'Order Rejected',
          channel: 'push',
        }),
      });
    });

    it('should create notification for DECISION_BLOCKED', async () => {
      const sqsRecord = fakeSqsRecord('DECISION_BLOCKED', complianceCheckSubject({ decisionId: 'd1' }), { tenantId: 'tenant-1' });
      const result = await harness.process([sqsRecord]);
      expect(result.intents[0]).toMatchObject({
        typename: 'Notification',
        fields: expect.objectContaining({
          title: 'Decision Blocked',
          channel: 'push',
        }),
      });
    });

    it('should create notification for WITHDRAWAL_SETTLED', async () => {
      const sqsRecord = fakeSqsRecord('WITHDRAWAL_SETTLED', fundingSnapshotSubject({ transferId: 'xfr-w1' }), { tenantId: 'tenant-1' });
      const result = await harness.process([sqsRecord]);
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
        fakeSqsRecord('ONBOARDING_COMPLETED', {}, { tenantId: 't1' }),
        fakeSqsRecord('MANDATE_ISSUED', mandateSubject(), { tenantId: 't2' }),
        fakeSqsRecord('ORDER_FILLED', normalizedOrderSubject({ orderId: 'o1' }), { tenantId: 't3' }),
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

  describe('parseSubject contract enforcement', () => {
    it('ORDER_FILLED with empty subject throws ZodError (contract violation becomes poison-pill)', async () => {
      // The event-processor harness surfaces handler throws as result.errors entries.
      // An empty {} subject violates NormalizedOrderEventSchema (orderId, executionMode required).
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {}, { tenantId: 't-zod', eventId: 'evt-zod' }),
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBeInstanceOf(ZodError);
    });

    it('DECISION_APPROVED with empty subject throws ZodError', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {}, { tenantId: 't-zod', eventId: 'evt-zod2' }),
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBeInstanceOf(ZodError);
    });
  });
});
