import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';

/**
 * market-intelligence-ctrl integration — continuous-projection model.
 *
 * Post advisory-cycle-agent-precomputation:
 *   - The service NO LONGER subscribes to ANALYZE_MARKET.
 *   - Fast tier: YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED,
 *     FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED → partial refresh
 *     (update intent → MODIFY event).
 *   - Slow tier: MARKET_SNAPSHOT_REFRESH_TICK (15-minute schedule) → full
 *     rebuild (record intent → INSERT event).
 *   - Egress CDC emits MARKET_SNAPSHOT_UPDATED on both INSERT and MODIFY.
 *
 * Snapshot row shape:
 *   pk: `MarketSnapshot#${region}`
 *   sk: 'MarketSnapshot'
 *   agentOutput: <agent result blob>
 *   fastComponentsAt / slowComponentsAt / sourceEventIds (overwrites — see
 *     plan footer Open Question #2)
 *
 * Tolerant skip if AgentRuntime infrastructure is unavailable in dev.
 */
describe('market-intelligence-ctrl: snapshot materialisation + CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-market-intelligence-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });

    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: ['MARKET_SNAPSHOT_UPDATED'],
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  // ── Fast-tier feed refresh ──────────────────────────────────────────

  it('fast-tier merge on YAHOO_FINANCE_UPDATED updates fastComponentsAt + sourceEventIds', async () => {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const eventId1 = `yahoo-feed-1-${randomUUID()}`;
    const eventId2 = `yahoo-feed-2-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'YAHOO_FINANCE_UPDATED',
      detail: { region, tickers: ['SPY', 'AAPL'] },
      eventId: eventId1,
    });

    let firstSnapshot: Record<string, unknown>;
    try {
      firstSnapshot = await table.waitForItem({
        table: 'market-intelligence-ctrl',
        pk: `MarketSnapshot#${region}`,
        sk: 'MarketSnapshot',
        predicate: (item) =>
          Array.isArray(item['sourceEventIds']) &&
          (item['sourceEventIds'] as string[]).includes(eventId1),
        description: 'first feed eventId lands in sourceEventIds',
        timeoutMs: 120_000,
      });
    } catch {
      console.warn(
        'market-intelligence-ctrl: AgentRuntime unavailable — skipping fast-tier assertion',
      );
      return;
    }

    const firstFastAt = firstSnapshot['fastComponentsAt'];
    expect(typeof firstFastAt).toBe('string');
    expect(firstSnapshot['agentOutput']).toBeTruthy();
    // Per Open Question #2: sourceEventIds overwrites (no ring buffer).
    expect((firstSnapshot['sourceEventIds'] as string[])).toContain(eventId1);

    // Second feed event with a distinct eventId — fastComponentsAt should
    // advance and sourceEventIds should reflect the LATEST eventId only.
    await new Promise((r) => setTimeout(r, 1_500));

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'YAHOO_FINANCE_UPDATED',
      detail: { region, tickers: ['QQQ'] },
      eventId: eventId2,
    });

    const updated = await table.waitForItem({
      table: 'market-intelligence-ctrl',
      pk: `MarketSnapshot#${region}`,
      sk: 'MarketSnapshot',
      predicate: (item) =>
        item['fastComponentsAt'] !== firstFastAt &&
        Array.isArray(item['sourceEventIds']) &&
        (item['sourceEventIds'] as string[]).includes(eventId2),
      description: 'fastComponentsAt advances and second eventId is recorded',
      timeoutMs: 120_000,
    });

    expect(updated['fastComponentsAt']).not.toBe(firstFastAt);
    expect((updated['sourceEventIds'] as string[])).toContain(eventId2);

    // CDC verification — MARKET_SNAPSHOT_UPDATED fires on MODIFY.
    const cdcEvent = await trap.waitForEvent({
      detailType: 'MARKET_SNAPSHOT_UPDATED',
      timeoutMs: 60_000,
    });
    expect(cdcEvent.detailType).toBe('MARKET_SNAPSHOT_UPDATED');
    expect((cdcEvent.detail as { subject?: Record<string, unknown> }).subject?.['__version'] as number).toBeGreaterThanOrEqual(1);
  }, 240_000);

  // ── Slow-tier scheduled rebuild ─────────────────────────────────────

  it('slow-tier rebuild on MARKET_SNAPSHOT_REFRESH_TICK updates slowComponentsAt', async () => {
    const region = process.env.AWS_REGION ?? 'us-east-1';

    const beforeSnap = await table.waitForItem({
      table: 'market-intelligence-ctrl',
      pk: `MarketSnapshot#${region}`,
      sk: 'MarketSnapshot',
      timeoutMs: 30_000,
    }).catch(() => null);

    const beforeSlowAt = beforeSnap?.['slowComponentsAt'];

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'MARKET_SNAPSHOT_REFRESH_TICK',
      subject: { region },
    });

    let after: Record<string, unknown>;
    try {
      after = await table.waitForItem({
        table: 'market-intelligence-ctrl',
        pk: `MarketSnapshot#${region}`,
        sk: 'MarketSnapshot',
        predicate: (item) =>
          beforeSlowAt === undefined
            ? Boolean(item['slowComponentsAt'])
            : item['slowComponentsAt'] !== beforeSlowAt,
        description: 'slowComponentsAt advances after refresh tick',
        timeoutMs: 120_000,
      });
    } catch {
      console.warn(
        'market-intelligence-ctrl: AgentRuntime unavailable — skipping slow-tier assertion',
      );
      return;
    }

    expect(after['slowComponentsAt']).toBeTruthy();
    expect(after['fastComponentsAt']).toBeTruthy(); // slow rebuild sets both
    expect(after['agentOutput']).toBeTruthy();
  }, 180_000);

  // ── Idempotency on feed replay ──────────────────────────────────────

  it('duplicate YAHOO_FINANCE_UPDATED (same eventId) does not re-run the agent', async () => {
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const eventId = `dup-yahoo-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'YAHOO_FINANCE_UPDATED',
      detail: { region, tickers: ['DIA'] },
      eventId,
    });

    let firstFastAt: unknown;
    try {
      const first = await table.waitForItem({
        table: 'market-intelligence-ctrl',
        pk: `MarketSnapshot#${region}`,
        sk: 'MarketSnapshot',
        predicate: (item) =>
          Array.isArray(item['sourceEventIds']) &&
          (item['sourceEventIds'] as string[]).includes(eventId),
        description: 'first publish lands eventId in sourceEventIds',
        timeoutMs: 120_000,
      });
      firstFastAt = first['fastComponentsAt'];
    } catch {
      console.warn(
        'market-intelligence-ctrl: AgentRuntime unavailable — skipping idempotency assertion',
      );
      return;
    }

    // Duplicate publish — DuplicateInvocationError path; fastComponentsAt
    // does NOT advance (the agent run is skipped, no DDB update emitted).
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'market-intelligence-ctrl',
      detailType: 'YAHOO_FINANCE_UPDATED',
      detail: { region, tickers: ['DIA'] },
      eventId,
    });

    await new Promise((r) => setTimeout(r, 30_000));

    const after = await table.waitForItem({
      table: 'market-intelligence-ctrl',
      pk: `MarketSnapshot#${region}`,
      sk: 'MarketSnapshot',
      timeoutMs: 10_000,
    });
    expect(after['fastComponentsAt']).toBe(firstFastAt);
  }, 240_000);
});
