import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
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
  // BALANCE_UPDATED → project('PortfolioLatest', ...) → pk: Portfolio#<tenantId>, sk: Latest
  // PORTFOLIO_UPDATED → project('Position', ...) → pk: Portfolio#<tenantId>, sk: Position#<symbol>
  // LEDGER_ENTRY_RECORDED → record('HistoryEntry', ...) with override → pk: History#<tenantId>, sk: Entry#<sequenceNo>
  //
  // Note: get-balance.fn.js resolver and event-listener transform both use sk: 'Latest'.

  describe('event materializations', () => {
    it('should materialize BALANCE_UPDATED to PortfolioBalance in DDB', async () => {
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 500000,
          deltaCents: 50000,
        },
      });

      // project() → deterministic sk: Latest
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
        detail: {
          positions: {
            [symbol]: {
              symbol,
              quantity: 10,
              averageCostBasis: 150.0,
              totalCostBasis: 1500.0,
              lastFillPrice: 155.0,
            },
          },
        },
      });

      // project() → deterministic sk: Position#<symbol>
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
      // Use a large unique sequenceNo (avoids collision with previous runs and checkpoint boundary)
      const sequenceNo = 1000 + Math.floor(Math.random() * 8000); // 1000–8999, never a checkpoint (mod 100 ≠ 0)
      const eventId = `integ-entry-${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId,
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'test-order-001', symbol: 'AAPL', quantity: 5, fillPrice: 150.0 },
          timestamp: new Date().toISOString(),
          sequenceNo,
        },
      });

      // record() with explicit sk override → pk: History#<tenantId>, sk: Entry#<sequenceNo>
      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `History#${ctx.tenantId}`,
        sk: `Entry#${sequenceNo}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('HistoryEntry');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['eventType']).toBe('ORDER_FILLED');
      // eventId stored from event.subject.eventId — assert it is a non-empty string
      expect(item['eventId']).toEqual(expect.any(String));
      expect(item['sequenceNo']).toBe(sequenceNo);
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────
  //
  // JS resolvers use:
  //   getBalance      → pk: Portfolio#<tenantId>, sk: 'Latest'       (PortfolioLatest)
  //   getPortfolio    → pk: Portfolio#<tenantId>, sk beginsWith: ''  (Latest + Position# items)
  //   getPositions    → pk: Portfolio#<tenantId>, sk beginsWith: 'Position#'
  //   getOrderHistory → pk: History#<tenantId>    (no sk filter)
  //   getTimeTravelAvailability → pk: Checkpoint#<tenantId> (no sk filter, reads earliestDate/latestDate from sk)
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
        detail: {
          cashBalanceCents: 1_000_000,
          deltaCents: 50_000,
          snapshot: {
            cashBalanceCents: 800_000,
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 },
            },
            lastEventSequence: 99,
          },
        },
      });

      // 2. PORTFOLIO_UPDATED → Position#AAPL, Position#MSFT
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          positions: {
            AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150.0, totalCostBasis: 1500.0, lastFillPrice: 155.0 },
            MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 300.0, totalCostBasis: 1500.0, lastFillPrice: 310.0 },
          },
        },
      });

      // 3. LEDGER_ENTRY_RECORDED → HistoryEntry (Entry#99001, Entry#99002)
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-hist-query-001',
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'order-001', symbol: 'AAPL', quantity: 5, fillPrice: 150.0 },
          timestamp: new Date().toISOString(),
          sequenceNo: 99001,
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-hist-query-002',
          eventType: 'BALANCE_UPDATED',
          payload: { cashBalanceCents: 1000000 },
          timestamp: new Date().toISOString(),
          sequenceNo: 99002,
        },
      });

      // 4. LEDGER_ENTRY_RECORDED with sequenceNo % 100 === 0 → Checkpoint
      //    Must include cashBalanceCents and positions for checkpoint data
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-checkpoint-100',
          eventType: 'CHECKPOINT',
          payload: {},
          timestamp: '2025-01-15T00:00:00.000Z',
          sequenceNo: 100,
          cashBalanceCents: 500_000,
          positions: {},
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-checkpoint-200',
          eventType: 'CHECKPOINT',
          payload: {},
          timestamp: '2025-06-15T00:00:00.000Z',
          sequenceNo: 200,
          cashBalanceCents: 900_000,
          positions: { AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 } },
        },
      });

      // 5. LEDGER_ENTRY_RECORDED with streamType: 'simulated' → Simulation#Latest + SimulationPosition
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-sim-001',
          eventType: 'SIMULATED_TRADE',
          payload: {},
          timestamp: new Date().toISOString(),
          sequenceNo: 1,
          streamType: 'simulated',
          cashBalanceCents: 950_000,
          positions: {
            AAPL: { symbol: 'AAPL', quantity: 12, averageCostBasis: 148.0, totalCostBasis: 1776.0, lastFillPrice: 155.0 },
          },
        },
      });

      // Wait for all materializations
      await table.waitForItem({
        table: 'ledger-bff',
        pk: portfolioPk(),
        sk: 'Latest',
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
        sk: 'Entry#99001',
        timeoutMs: 30_000,
      });
      // Wait for checkpoint
      await table.waitForItem({
        table: 'ledger-bff',
        pk: checkpointPk(),
        sk: '2025-01-15',
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
      // Returned in reverse order (scanIndexForward: false) — highest seq first
      const orderFilled = result.getOrderHistory.items.find(i => i.eventType === 'ORDER_FILLED');
      expect(orderFilled).toBeDefined();
      expect(orderFilled!.sequenceNo).toBe(99001);
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

      expect(result.getTimeTravelAvailability).toBeDefined();
      // earliestDate = first checkpoint sk, latestDate = last checkpoint sk
      expect(result.getTimeTravelAvailability.earliestDate).toBe('2025-01-15');
      expect(result.getTimeTravelAvailability.latestDate).toBe('2025-06-15');
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
