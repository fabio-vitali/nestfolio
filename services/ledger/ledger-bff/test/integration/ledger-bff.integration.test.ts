import {
  EventBridgeClient,
  CognitoFixture,
  AppSyncClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('ledger-bff', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'ledger-bff');
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────
  //
  // BALANCE_UPDATED → projectVersioned('PortfolioLatest', ...) → pk: Portfolio#<tenantId>, sk: Latest
  // PORTFOLIO_UPDATED → projectVersioned('Position', ...) → pk: Portfolio#<tenantId>, sk: Position#<symbol>
  // LEDGER_ENTRY_RECORDED → record('HistoryEntry', ...) with override → pk: History#<tenantId>, sk: <8-digit padded lastEventSequence>
  //
  // Note: get-balance.fn.js resolver and event-listener transform both use sk: 'Latest'.

  describe('event materializations', () => {
    it('should materialize BALANCE_UPDATED to PortfolioBalance in DDB', async () => {
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        subject: {
          cashBalanceCents: 500000,
          snapshot: { positions: {}, cashBalanceCents: 500000, lastEventSequence: 1 },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.userId },
      });

      // projectVersioned() → deterministic sk: Latest
      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: 'Latest',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PortfolioLatest');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['cashBalanceCents']).toBe(500000);
    }, 120_000);

    it('should materialize PORTFOLIO_UPDATED to Position entries in DDB', async () => {
      const symbol = `TEST${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        subject: {
          positions: {
            [symbol]: {
              symbol,
              quantity: 10,
              averageCostBasis: 150.0,
              totalCostBasis: 1500.0,
              lastFillPrice: 155.0,
            },
          },
          snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 1 },
        },
      });

      // projectVersioned() → deterministic sk: Position#<symbol>
      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: `Position#${symbol}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('Position');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['symbol']).toBe(symbol);
      expect(item['quantity']).toBe(10);
    }, 120_000);

    it('should materialize LEDGER_ENTRY_RECORDED to HistoryEntry in DDB', async () => {
      const lastEventSequence = 1001 + Math.floor(Math.random() * 99); // 1001–1099
      const eventId = `integ-entry-${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId,
        subject: {
          streamType: 'actual',
          lastEventSequence,
          snapshotAt: new Date().toISOString(),
          snapshot: {
            positions: { AAPL: { symbol: 'AAPL', quantity: 5, averageCostBasis: 150.0, totalCostBasis: 750.0, lastFillPrice: 150.0 } },
            cashBalanceCents: 250_000,
            lastEventSequence,
          },
        },
      });

      // record() with sk override → pk: History#<tenantId>, sk: <8-digit padded seq>
      const sk = String(lastEventSequence).padStart(8, '0');
      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `History#${ctx.tenantId}`,
        sk,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('HistoryEntry');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['eventType']).toBe('LEDGER_ENTRY_RECORDED'); // generic envelope detail-type
      expect(item['sequenceNo']).toBe(lastEventSequence);
      expect(item['eventId']).toBe(eventId);                   // auto-injected by record() executor
      expect(item['createdAt']).toEqual(expect.any(String));   // auto-injected by record() executor
    }, 120_000);
  });

  // ── Version guard (P1 projection) ───────────────────────────────────
  //
  // projectVersioned drops stale/duplicate deliveries (no clobber). We assert
  // the materialized __version never regresses and the stale event's field
  // value never wins.
  describe('version guard', () => {
    it('keeps the newest version and drops a stale BALANCE_UPDATED', async () => {
      const pk = `Portfolio#${ctx.tenantId}`;

      // Fresh write at version 20.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        subject: {
          cashBalanceCents: 2_000_000,
          snapshot: { positions: {}, cashBalanceCents: 2_000_000, lastEventSequence: 20 },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.userId },
      });
      const fresh = await table.waitForItem({
        table: 'ledger-bff',
        pk,
        sk: 'Latest',
        timeoutMs: 60_000,
        predicate: (item) => item['__version'] === 20,
        description: 'version=20 applied',
      });
      expect(fresh['__version']).toBe(20);
      expect(fresh['cashBalanceCents']).toBe(2_000_000);

      // Stale write at version 10 — must be dropped, not applied.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        subject: {
          cashBalanceCents: 111,
          snapshot: { positions: {}, cashBalanceCents: 111, lastEventSequence: 10 },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.userId },
      });

      // Give the stale event time to traverse EB → SQS → Lambda before we
      // assert non-regression — otherwise the early loop iterations would
      // assert before the stale write could even have clobbered the row.
      await new Promise((r) => setTimeout(r, 6_000));

      // Settle window: poll for ~16s asserting the row never regresses to the stale value.
      for (let i = 0; i < 8; i++) {
        const item = await table.waitForItem({ table: 'ledger-bff', pk, sk: 'Latest', timeoutMs: 30_000 });
        expect(item['__version']).toBe(20);
        expect(item['cashBalanceCents']).toBe(2_000_000);
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // A newer write at version 30 IS applied.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        subject: {
          cashBalanceCents: 3_000_000,
          snapshot: { positions: {}, cashBalanceCents: 3_000_000, lastEventSequence: 30 },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.userId },
      });
      const applied = await table.waitForItem({
        table: 'ledger-bff',
        pk,
        sk: 'Latest',
        predicate: (item) => item['__version'] === 30 && item['cashBalanceCents'] === 3_000_000,
        timeoutMs: 60_000,
      });
      expect(applied['__version']).toBe(30);
      expect(applied['cashBalanceCents']).toBe(3_000_000);
    }, 180_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────
  //
  // JS resolvers use:
  //   getBalance      → pk: Portfolio#<tenantId>, sk: 'Latest'       (PortfolioLatest)
  //   getPortfolio    → pk: Portfolio#<tenantId>, sk beginsWith: ''  (Latest + Position# items)
  //   getPositions    → pk: Portfolio#<tenantId>, sk beginsWith: 'Position#'
  //   getOrderHistory → pk: History#<tenantId>    (no sk filter)
  //   getTimeTravelAvailability → pk: Checkpoint#<tenantId> (no sk filter, reads earliestDate/latestDate from sk = processing date)
  //   getPerformance  → pk: Portfolio#<tenantId>, sk beginsWith: ''  (Latest + Position# items)
  //
  // Lambda resolvers:
  //   getPortfolioAt  → pk: SnapshotAt#<tenantId>#actual, sk <= timestamp
  //   getSimulationComparison → pk: Portfolio#<tenantId> Latest + positions;
  //                             pk: Simulation#<tenantId> Latest + positions
  //
  // All items are materialized via events before the describe block runs.

  describe('AppSync queries', () => {
    const portfolioPk = () => `Portfolio#${ctx.tenantId}`;
    const historyPk = () => `History#${ctx.tenantId}`;
    const checkpointPk = () => `Checkpoint#${ctx.tenantId}`;
    const simulationPk = () => `Simulation#${ctx.tenantId}`;

    beforeAll(async () => {
      // ── Event-driven fixtures ─────────────────────────────────────────

      // 1. BALANCE_UPDATED → PortfolioLatest (sk: 'Latest') + SnapshotAt
      //    Include snapshot data so the transform also writes SnapshotAt
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        subject: {
          cashBalanceCents: 1_000_000,
          snapshot: {
            cashBalanceCents: 800_000,
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 },
            },
            lastEventSequence: 99,
          },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.userId },
      });

      // 2. PORTFOLIO_UPDATED → Position#AAPL, Position#MSFT
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        subject: {
          positions: {
            AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150.0, totalCostBasis: 1500.0, lastFillPrice: 155.0 },
            MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 300.0, totalCostBasis: 1500.0, lastFillPrice: 310.0 },
          },
          // snapshot is the point-in-time view materialized into SnapshotAt#actual and
          // read back by getPortfolioAt (latest SnapshotAt). Keep it aligned with the
          // BALANCE_UPDATED snapshot above (800k / AAPL qty 8) so the time-travel
          // assertion stays stable; the top-level `positions` (qty 10/5) drive the
          // versioned Position rows that getPositions reads.
          snapshot: {
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 },
            },
            cashBalanceCents: 800_000,
            lastEventSequence: 99,
          },
        },
      });

      // 3. LEDGER_ENTRY_RECORDED (actual) → HistoryEntry rows (00099001, 00099002)
      //    + a Checkpoint at today's processing date.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-hist-query-001',
        subject: {
          streamType: 'actual',
          lastEventSequence: 99001,
          snapshotAt: new Date().toISOString(),
          snapshot: {
            cashBalanceCents: 800_000,
            positions: { AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 } },
            lastEventSequence: 99001,
          },
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-hist-query-002',
        subject: {
          streamType: 'actual',
          lastEventSequence: 99002,
          snapshotAt: new Date().toISOString(),
          snapshot: {
            cashBalanceCents: 1_000_000,
            positions: {},
            lastEventSequence: 99002,
          },
        },
      });

      // 4. LEDGER_ENTRY_RECORDED (simulated) → Simulation#Latest + SimulationPosition
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-sim-001',
        subject: {
          streamType: 'simulated',
          lastEventSequence: 1,
          snapshotAt: new Date().toISOString(),
          snapshot: {
            cashBalanceCents: 950_000,
            lastEventSequence: 1,
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 12, averageCostBasis: 148.0, totalCostBasis: 1776.0, lastFillPrice: 155.0 },
            },
          },
        },
      });

      // Wait for all materializations
      const today = new Date().toISOString().slice(0, 10);
      // NB: the event-materializations block above already left a Portfolio#Latest
      // row at __version 30 (cashBalanceCents 3_000_000). An existence-only wait
      // here returns instantly against that stale row, racing the version-99 /
      // 1_000_000 BALANCE_UPDATED emitted in this beforeAll. Wait for the v99 write
      // to actually supersede it so the AppSync queries read 1_000_000 deterministically.
      await table.waitForItem({
        table: 'ledger-bff',
        pk: portfolioPk(),
        sk: 'Latest',
        predicate: (item) =>
          item['__version'] === 99 && item['cashBalanceCents'] === 1_000_000,
        timeoutMs: 90_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: portfolioPk(),
        sk: 'Position#AAPL',
        timeoutMs: 30_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: historyPk(),
        sk: '00099001',
        timeoutMs: 30_000,
      });
      // One checkpoint per active date — actual entries above land on today.
      await table.waitForItem({
        table: 'ledger-bff',
        pk: checkpointPk(),
        sk: today,
        timeoutMs: 30_000,
      });
      // Wait for simulation
      await table.waitForItem({
        table: 'ledger-bff',
        pk: simulationPk(),
        sk: 'Latest',
        timeoutMs: 30_000,
      });
    }, 120_000);

    it('should return cashBalanceCents via getBalance', async () => {
      const result = await appsync.query<{
        getBalance: {
          cashBalanceCents: number;
        };
      }>(`
        query GetBalance {
          getBalance {
            cashBalanceCents
          }
        }
      `, {});

      expect(result.getBalance).toBeDefined();
      expect(result.getBalance.cashBalanceCents).toBe(1_000_000);
    }, 60_000);

    it('should return positions via getPositions (all)', async () => {
      const result = await appsync.query<{
        getPositions: Array<{
          symbol: string;
          quantity: number;
          averageCostBasis: number;
          totalCostBasis: number;
          lastFillPrice: number;
        }>;
      }>(`
        query GetPositions {
          getPositions {
            symbol
            quantity
            averageCostBasis
            totalCostBasis
            lastFillPrice
          }
        }
      `, {});

      expect(Array.isArray(result.getPositions)).toBe(true);
      const aapl = result.getPositions.find(p => p.symbol === 'AAPL');
      expect(aapl).toBeDefined();
      expect(aapl!.quantity).toBe(10);
      expect(aapl!.lastFillPrice).toBe(155.0);

      const msft = result.getPositions.find(p => p.symbol === 'MSFT');
      expect(msft).toBeDefined();
      expect(msft!.quantity).toBe(5);
    }, 60_000);

    it('should return a single position via getPositions(symbol)', async () => {
      const result = await appsync.query<{
        getPositions: Array<{
          symbol: string;
          quantity: number;
          averageCostBasis: number;
          totalCostBasis: number;
          lastFillPrice: number;
        }>;
      }>(`
        query GetPosition($symbol: String) {
          getPositions(symbol: $symbol) {
            symbol
            quantity
            averageCostBasis
            totalCostBasis
            lastFillPrice
          }
        }
      `, { symbol: 'AAPL' });

      expect(Array.isArray(result.getPositions)).toBe(true);
      expect(result.getPositions).toHaveLength(1);
      expect(result.getPositions[0].symbol).toBe('AAPL');
      expect(result.getPositions[0].quantity).toBe(10);
    }, 60_000);

    it('should return order history page via getOrderHistory', async () => {
      const result = await appsync.query<{
        getOrderHistory: {
          items: Array<{
            eventType: string;
            payload: string;
            createdAt: string;
            sequenceNo: number;
          }>;
          nextToken: string | null;
        };
      }>(`
        query GetOrderHistory {
          getOrderHistory(limit: 10) {
            items {
              eventType
              payload
              createdAt
              sequenceNo
            }
            nextToken
          }
        }
      `, {});

      expect(result.getOrderHistory).toBeDefined();
      expect(Array.isArray(result.getOrderHistory.items)).toBe(true);
      // Entries carry the generic envelope detail-type; identify by sequenceNo.
      const entry = result.getOrderHistory.items.find(i => i.sequenceNo === 99001);
      expect(entry).toBeDefined();
      expect(entry!.eventType).toBe('LEDGER_ENTRY_RECORDED');
    }, 60_000);

    it('should return TimeTravelAvailability via getTimeTravelAvailability', async () => {
      const result = await appsync.query<{
        getTimeTravelAvailability: {
          earliestDate: string | null;
          latestDate: string | null;
        };
      }>(`
        query GetTimeTravelAvailability {
          getTimeTravelAvailability {
            earliestDate
            latestDate
          }
        }
      `, {});

      const today = new Date().toISOString().slice(0, 10);
      expect(result.getTimeTravelAvailability).toBeDefined();
      // One checkpoint per active date — all actual entries above land on today.
      expect(result.getTimeTravelAvailability.earliestDate).toBe(today);
      expect(result.getTimeTravelAvailability.latestDate).toBe(today);
    }, 60_000);

    it('should return portfolio at a past timestamp via getPortfolioAt (Lambda resolver)', async () => {
      // SnapshotAt sk = event.timestamp (processing time), so use far-future to ensure it's found
      const queryTimestamp = '2099-12-31T23:59:59.000Z';

      const result = await appsync.query<{
        getPortfolioAt: {
          cashBalanceCents: number;
          totalValueCents: number;
          positions: Array<{
            symbol: string;
            quantity: number;
            averageCostBasis: number;
            totalCostBasis: number;
            lastFillPrice: number;
          }>;
        };
      }>(`
        query GetPortfolioAt($timestamp: String!) {
          getPortfolioAt(timestamp: $timestamp) {
            cashBalanceCents
            totalValueCents
            positions {
              symbol
              quantity
              averageCostBasis
              totalCostBasis
              lastFillPrice
            }
          }
        }
      `, { timestamp: queryTimestamp });

      expect(result.getPortfolioAt).toBeDefined();
      // Should reconstruct from the event-materialized SnapshotAt record
      expect(result.getPortfolioAt.cashBalanceCents).toBe(800_000);
      expect(Array.isArray(result.getPortfolioAt.positions)).toBe(true);
      const aapl = result.getPortfolioAt.positions.find(p => p.symbol === 'AAPL');
      expect(aapl).toBeDefined();
      expect(aapl!.quantity).toBe(8);
    }, 60_000);

    it('should return simulation comparison via getSimulationComparison (Lambda resolver)', async () => {
      const result = await appsync.query<{
        getSimulationComparison: {
          actual: {
            cashBalanceCents: number;
            totalValueCents: number;
            positions: Array<{ symbol: string; quantity: number }>;
          };
          simulated: {
            cashBalanceCents: number;
            totalValueCents: number;
            positions: Array<{ symbol: string; quantity: number }>;
          };
          cashDeltaCents: number;
          positionDiffs: Array<{
            symbol: string;
            actualQuantity: number;
            simulatedQuantity: number;
            quantityDiff: number;
          }>;
        };
      }>(`
        query GetSimulationComparison {
          getSimulationComparison {
            actual {
              cashBalanceCents
              totalValueCents
              positions {
                symbol
                quantity
              }
            }
            simulated {
              cashBalanceCents
              totalValueCents
              positions {
                symbol
                quantity
              }
            }
            cashDeltaCents
            positionDiffs {
              symbol
              actualQuantity
              simulatedQuantity
              quantityDiff
            }
          }
        }
      `, {});

      expect(result.getSimulationComparison).toBeDefined();
      // actual: Portfolio#<tenantId> Latest (cashBalanceCents: 1_000_000) + positions (AAPL qty 10, MSFT qty 5)
      expect(result.getSimulationComparison.actual.cashBalanceCents).toBe(1_000_000);
      // simulated: Simulation#<tenantId> Latest (cashBalanceCents: 950_000) + Position#AAPL qty 12
      expect(result.getSimulationComparison.simulated.cashBalanceCents).toBe(950_000);
      // cashDeltaCents = simulated - actual = 950_000 - 1_000_000 = -50_000
      expect(result.getSimulationComparison.cashDeltaCents).toBe(-50_000);

      // Position diffs should include AAPL (actual=10, simulated=12, diff=2)
      const aaplDiff = result.getSimulationComparison.positionDiffs.find(d => d.symbol === 'AAPL');
      expect(aaplDiff).toBeDefined();
      expect(aaplDiff!.actualQuantity).toBe(10);
      expect(aaplDiff!.simulatedQuantity).toBe(12);
      expect(aaplDiff!.quantityDiff).toBe(2);
    }, 60_000);
  });
});
