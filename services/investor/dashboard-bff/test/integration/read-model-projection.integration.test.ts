import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
} from '@nestfolio/integration-testing';

const snapshotDetail = (lastEventSequence: number, cashBalanceCents: number) => ({
  cashBalanceCents,
  snapshot: {
    cashBalanceCents,
    lastEventSequence,
    positions: {
      AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    },
  },
});

describe('dashboard-bff read-model projection (w2)', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  const publish = (seq: number, cash: number) =>
    eb.putEvent({
      bus: 'investor',
      targetService: 'dashboard-bff',
      detailType: 'BALANCE_UPDATED',
      subject: snapshotDetail(seq, cash),
    });

  it('projects a full PortfolioSummary row — no structural zeros, no double-count', async () => {
    await publish(7, 5000);
    const row = await table.waitForItem({
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      sk: 'PortfolioSummary',
      timeoutMs: 60_000,
      predicate: (i) => i['__version'] === 7,
    });
    expect(row['cashBalanceCents']).toBe(5000);
    expect(row['positionCount']).toBe(1);
    expect(row['totalValueCents']).toBe(155000); // 5000 + 10*150*100
  }, 120_000);

  it('drops a stale (lower-version) snapshot and keeps the newest', async () => {
    await publish(20, 9999);
    await table.waitForItem({
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      sk: 'PortfolioSummary',
      timeoutMs: 60_000,
      predicate: (i) => i['__version'] === 20,
    });

    await publish(3, 1111); // stale → must be dropped
    await new Promise((r) => setTimeout(r, 6_000));
    for (let i = 0; i < 6; i++) {
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 30_000,
      });
      expect(item['__version']).toBe(20);
      expect(item['cashBalanceCents']).toBe(9999);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }, 180_000);

  it('projects one versioned PositionSnapshot row per holding', async () => {
    const sd = snapshotDetail(25, 5000);
    await eb.putEvent({
      bus: 'investor',
      targetService: 'dashboard-bff',
      detailType: 'PORTFOLIO_UPDATED',
      subject: { positions: sd.snapshot.positions, snapshot: sd.snapshot },
    });
    const aapl = await table.waitForItem({
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      sk: 'PositionSnapshot#AAPL',
      timeoutMs: 60_000,
      predicate: (i) => i['__version'] === 25,
    });
    expect(aapl['marketValueCents']).toBe(150000);
    expect(aapl['quantity']).toBe(10);
  }, 120_000);
});
