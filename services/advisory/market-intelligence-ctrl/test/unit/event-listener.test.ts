const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
  };
});

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.MEMORY_ID = 'mem-test';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import type { MemoryClient } from '@nestfolio/agent-orchestrator';
import { createHandlers, type IngressDeps } from '../../src/handlers/event-listener';

describe('market-intelligence-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();

  const mockDeps: IngressDeps = {
    agentService: { runPipeline: mockRunPipeline },
    memoryClient: {} as MemoryClient,
  };

  const handlers = createHandlers(mockDeps);

  const makeCtx = (overrides: Partial<EventContext> = {}): EventContext => ({
    eventId: 'evt-1',
    eventType: 'YAHOO_FINANCE_UPDATED',
    tenantId: asTenantId('SYSTEM'),
    userId: asUserId('system'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'market-intelligence-ctrl',
    record: {},
    ...overrides,
  });

  const defaultAgentResult = {
    signals: [],
    tickersMentioned: [],
    marketOutlook: 'neutral',
    confidenceScore: 0.7,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue(defaultAgentResult);
  });

  describe('MARKET_SNAPSHOT_REFRESH_TICK handler (slow-tier)', () => {
    // The regional MarketSnapshot row is long-lived: one row per region,
    // created at bootstrap and rebuilt by every 15-min REFRESH_TICK forever.
    // Slow-tier MUST upsert, not create-only — a `record()` intent fails
    // `attribute_not_exists(pk)` on every tick after the first (~95 CCFEx/day
    // observed in production-dev 2026-05-28). `update()` with no explicit
    // condition is a DDB UpdateItem upsert, identical shape to the already-
    // working fast-tier path.
    it('emits MarketSnapshot update intent (upsert) with both fastComponentsAt and slowComponentsAt set', async () => {
      const payload: EventPayload = {
        subject: {},
      };

      const ctx = makeCtx({ eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', eventId: 'tick-1' });
      const result = await handlers.MARKET_SNAPSHOT_REFRESH_TICK(payload, ctx);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'tick-1',
        expect.objectContaining({
          subject: expect.objectContaining({ region: 'us-east-1', decisionId: 'snapshot-tick-1' }),
          context: expect.objectContaining({ tenantId: expect.any(String) }),
        }),
      );

      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'MarketSnapshot',
          updates: expect.objectContaining({
            region: 'us-east-1',
            slowComponentsAt: expect.any(String),
            fastComponentsAt: expect.any(String),
            sourceEventIds: ['tick-1'],
          }),
          overrides: expect.objectContaining({
            pk: 'MarketSnapshot#us-east-1',
            sk: 'MarketSnapshot',
          }),
        }),
      ]));

      const snapshotIntent = result.find(
        (i): i is { _tag: string; condition?: string } =>
          (i as { typename?: string }).typename === 'MarketSnapshot',
      );
      // Unconditional update — UpdateCommand without ConditionExpression
      // is a natural DDB upsert. Adding a condition would re-introduce
      // the CCFEx-on-existing-row failure mode this fix removes.
      expect(snapshotIntent?.condition).toBeUndefined();
      expect((snapshotIntent as unknown as { add?: Record<string, number> })?.add).toEqual({ __version: 1 });
    });

    it('derives region from the RegionContext (ctx.region), not the subject', async () => {
      const payload: EventPayload = { subject: {} };
      const ctx = makeCtx({ eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', eventId: 'tick-region', region: 'eu-west-1' });

      const result = await handlers.MARKET_SNAPSHOT_REFRESH_TICK(payload, ctx);

      const snapshotIntent = result.find(
        (i): i is { _tag: 'update'; typename: string; updates: Record<string, unknown>; overrides?: { pk?: string; sk?: string } } =>
          (i as { typename?: string }).typename === 'MarketSnapshot',
      );
      expect(snapshotIntent).toBeDefined();
      expect(snapshotIntent!.updates.region).toBe('eu-west-1');
      expect(snapshotIntent!.overrides?.pk).toBe('MarketSnapshot#eu-west-1');
    });

    it('falls back to AWS_REGION / us-east-1 when ctx.region is absent', async () => {
      const payload: EventPayload = { subject: {} };
      const ctx = makeCtx({ eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', eventId: 'tick-2', region: undefined as unknown as string });

      const result = await handlers.MARKET_SNAPSHOT_REFRESH_TICK(payload, ctx);

      const snapshotIntent = result.find(
        (i): i is { _tag: 'update'; typename: string; updates: Record<string, unknown>; overrides?: { pk?: string; sk?: string } } =>
          (i as { typename?: string }).typename === 'MarketSnapshot',
      );
      expect(snapshotIntent).toBeDefined();
      expect(snapshotIntent!.updates.region).toBe(process.env.AWS_REGION ?? 'us-east-1');
    });

    it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
      const { DuplicateInvocationError } = await import('../../src/agent-service');
      mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('tick-dup'));

      const payload: EventPayload = { subject: {} };
      const ctx = makeCtx({ eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', eventId: 'tick-dup' });

      const result = await handlers.MARKET_SNAPSHOT_REFRESH_TICK(payload, ctx);

      expect(result).toEqual([]);
    });

    it('propagates non-duplicate agent errors', async () => {
      mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

      const payload: EventPayload = { subject: {} };
      const ctx = makeCtx({ eventType: 'MARKET_SNAPSHOT_REFRESH_TICK', eventId: 'tick-err' });

      await expect(handlers.MARKET_SNAPSHOT_REFRESH_TICK(payload, ctx)).rejects.toThrow('Agent pipeline failed');
    });
  });

  describe.each([
    ['YAHOO_FINANCE_UPDATED'],
    ['MARKETWATCH_UPDATED'],
    ['SEC_8K_FILED'],
    ['FRED_INDICATORS_UPDATED'],
    ['ALPHA_VANTAGE_NEWS_UPDATED'],
  ] as const)('%s handler (fast-tier)', (eventType) => {
    it('runs the agent and emits a MarketSnapshot update intent with fastComponentsAt set', async () => {
      const payload: EventPayload = { subject: {} };
      const ctx = makeCtx({ eventType, eventId: `feed-${eventType}-1` });

      const result = await handlers[eventType](payload, ctx);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        `feed-${eventType}-1`,
        expect.objectContaining({
          subject: expect.objectContaining({
            region: 'us-east-1',
            decisionId: `snapshot-feed-${eventType}-1`,
          }),
          context: expect.objectContaining({ tenantId: expect.any(String) }),
        }),
      );

      const snapshotIntent = result.find(
        (i): i is { _tag: 'update'; typename: string; updates: Record<string, unknown>; overrides?: { pk?: string; sk?: string } } =>
          (i as { typename?: string }).typename === 'MarketSnapshot',
      );
      expect(snapshotIntent).toBeDefined();
      expect(snapshotIntent!._tag).toBe('update');
      expect(snapshotIntent!.updates.fastComponentsAt).toBeDefined();
      expect(snapshotIntent!.updates.sourceEventIds).toEqual([`feed-${eventType}-1`]);
      // Fast-tier MUST NOT touch slowComponentsAt.
      expect(snapshotIntent!.updates).not.toHaveProperty('slowComponentsAt');
      expect(snapshotIntent!.overrides).toMatchObject({
        pk: 'MarketSnapshot#us-east-1',
        sk: 'MarketSnapshot',
      });
      expect((snapshotIntent as unknown as { add?: Record<string, number> }).add).toEqual({ __version: 1 });
    });
  });

  it('fast-tier handler returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../../src/agent-service');
    mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('feed-dup-1'));

    const payload: EventPayload = { subject: {} };
    const ctx = makeCtx({ eventType: 'YAHOO_FINANCE_UPDATED', eventId: 'feed-dup-1' });

    const result = await handlers.YAHOO_FINANCE_UPDATED(payload, ctx);

    expect(result).toEqual([]);
  });

  it('always emits an AgentInvocation record alongside the snapshot write', async () => {
    const payload: EventPayload = { subject: {} };
    const ctx = makeCtx({ eventType: 'YAHOO_FINANCE_UPDATED', eventId: 'feed-inv-1' });

    const result = await handlers.YAHOO_FINANCE_UPDATED(payload, ctx);

    const agentInvocation = (result as Array<{ typename?: string }>).find(
      (i) => i.typename === 'AgentInvocation',
    );
    expect(agentInvocation).toMatchObject({
      _tag: 'record',
      typename: 'AgentInvocation',
      fields: expect.objectContaining({ agentName: 'market-intelligence' }),
    });
  });
});
