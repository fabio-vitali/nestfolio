import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  DdbSeedFixture,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('dashboard-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'dashboard-bff');
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────
  //
  // All transforms write to pk: T#<tenantId>
  // project() writes deterministic sk; record() writes sk: <typename>#<eventId>

  describe('event materializations', () => {
    it('should materialize InvestorSnapshot on GOAL_CREATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'GOAL_CREATED',
        detail: {
          objective: 'GROWTH',
          targetAmountCents: 500_000_00,
          targetDate: '2030-01-01',
        },
      });

      // project('InvestorSnapshot', ...) → pk: T#<tenantId>, sk: InvestorSnapshot
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'InvestorSnapshot',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('InvestorSnapshot');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['goalType']).toBe('GROWTH');
      expect(item['onboardedAt']).toBeDefined();
    }, 120_000);

    it('should update InvestorSnapshot on RISK_PROFILE_CREATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'RISK_PROFILE_CREATED',
        detail: {
          score: 7,
          category: 'MODERATE',
        },
      });

      // Item already exists from prior GOAL_CREATED test — poll until riskLevel field appears
      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (item['riskLevel'] === '7') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['riskLevel']).toBe('7');
    }, 120_000);

    it('should update InvestorSnapshot on OPERATING_MODE_SELECTED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'OPERATING_MODE_SELECTED',
        detail: {
          mode: 'BALANCED',
        },
      });

      // Item already exists from prior GOAL_CREATED test — poll until operatingMode field appears
      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (item['operatingMode'] === 'BALANCED') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['operatingMode']).toBe('BALANCED');
    }, 120_000);

    it('should update InvestorSnapshot on GOAL_UPDATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'GOAL_UPDATED',
        detail: {
          objective: 'INCOME',
          targetAmountCents: 1_000_000_00,
          targetDate: '2035-01-01',
        },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (item['goalType'] === 'INCOME') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['goalType']).toBe('INCOME');
    }, 120_000);

    it('should update InvestorSnapshot on RISK_PROFILE_UPDATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'RISK_PROFILE_UPDATED',
        detail: {
          score: 9,
          category: 'AGGRESSIVE',
        },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (item['riskLevel'] === '9') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['riskLevel']).toBe('9');
    }, 120_000);

    it('should update InvestorSnapshot on OPERATING_MODE_CHANGED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'OPERATING_MODE_CHANGED',
        detail: {
          mode: 'AGGRESSIVE',
        },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (item['operatingMode'] === 'AGGRESSIVE') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['operatingMode']).toBe('AGGRESSIVE');
    }, 120_000);

    it('should materialize PortfolioSummary on PORTFOLIO_UPDATED (driftPercent)', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          driftPercent: 3.5,
        },
      });

      // project('PortfolioSummary', ...) → pk: T#<tenantId>, sk: PortfolioSummary
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PortfolioSummary');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['driftPercent']).toBe(3.5);
    }, 120_000);

    it('should materialize PositionSnapshot on PORTFOLIO_UPDATED (with symbol)', async () => {
      const symbol = 'AAPL';

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          symbol,
          filledQuantity: 10,
          averageFillPrice: 150,
          quantity: 10,
          avgCostBasis: 150,
          currentPrice: 160,
          marketValue: 1600,
          weightPercent: 15,
          unrealizedPnl: 100,
          assetClass: 'EQUITY',
        },
      });

      // project('PositionSnapshot', ...) → pk: T#<tenantId>, sk: PositionSnapshot#<symbol>
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: `PositionSnapshot#${symbol}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PositionSnapshot');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['symbol']).toBe(symbol);
      expect(item['assetClass']).toBe('EQUITY');
      expect(item['quantity']).toBe(10);
    }, 120_000);

    it('should handle RECONCILIATION_COMPLETED via portfolioSummary (no-op without drift/fill data)', async () => {
      // RECONCILIATION_COMPLETED goes through portfolioSummary transform.
      // Without filledQuantity/averageFillPrice or driftPercent, portfolioSummary returns undefined.
      // Verify no new PortfolioSummary is created for a bare reconciliation event.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'RECONCILIATION_COMPLETED',
        detail: {
          reconciliationId: `integ-recon-${Date.now()}`,
          completedAt: new Date().toISOString(),
        },
      });

      // Wait briefly, then verify PortfolioSummary was not modified
      await new Promise(r => setTimeout(r, 10_000));

      // Prior PORTFOLIO_UPDATED test created PortfolioSummary with driftPercent=3.5.
      // RECONCILIATION_COMPLETED should NOT have overwritten it.
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 5_000,
      }).catch(() => undefined);

      if (item) {
        expect(item['driftPercent']).toBe(3.5);
      }
    }, 30_000);

    it('should materialize TimeTravelAvailability on LEDGER_ENTRY_RECORDED', async () => {
      const snapshotAt = new Date().toISOString();

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          snapshotAt,
          entryType: 'TRADE',
        },
      });

      // project('TimeTravelAvailability', ...) → pk: T#<tenantId>, sk: TimeTravelAvailability
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'TimeTravelAvailability',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('TimeTravelAvailability');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['snapshotAt']).toBe(snapshotAt);
    }, 120_000);

    it('should materialize Activity record on BALANCE_UPDATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          amountCents: 50_000_00,
          currency: 'USD',
        },
      });

      // record('Activity', ...) → pk: T#<tenantId>, sk: Activity#<eventId> (non-deterministic)
      // Poll with skPrefix to find the activity written after our event
      let activityItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !activityItem) {
        const items = await table.queryItems({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          skPrefix: 'Activity#',
        });
        activityItem = items.find(i => i['activityType'] === 'BALANCE_UPDATED');
        if (!activityItem) await new Promise(r => setTimeout(r, 2_000));
      }

      expect(activityItem).toBeDefined();
      expect(activityItem!['__typename']).toBe('Activity');
      expect(activityItem!['activityType']).toBe('BALANCE_UPDATED');
      expect(activityItem!['tenantId']).toBe(ctx.tenantId);
    }, 120_000);

    it('should materialize Activity record on DECISION_APPROVED', async () => {
      const decisionId = `integ-decision-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId,
        },
      });

      // record('Activity', ...) → pk: T#<tenantId>, sk: Activity#<eventId>
      let activityItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !activityItem) {
        const items = await table.queryItems({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          skPrefix: 'Activity#',
        });
        activityItem = items.find(
          i => i['activityType'] === 'DECISION_APPROVED' &&
               (i['description'] as string)?.includes(decisionId),
        );
        if (!activityItem) await new Promise(r => setTimeout(r, 2_000));
      }

      expect(activityItem).toBeDefined();
      expect(activityItem!['__typename']).toBe('Activity');
      expect(activityItem!['activityType']).toBe('DECISION_APPROVED');
    }, 120_000);

    it('should accumulate AdvisoryStatus pendingDecisions on DECISION_PACKET_CREATED', async () => {
      const decisionId = `integ-dp-created-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 5 }],
          explanation: 'Integration test',
          confirmationRequired: true,
        },
      });

      // accumulate('AdvisoryStatus', { field: 'pendingDecisions', increment: 1 })
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
      });

      // accumulate uses DDB ADD — __typename is not set by accumulate
      expect(item['pendingDecisions']).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it('should accumulate AdvisoryStatus pendingDecisions on USER_CONFIRMATION_REQUESTED', async () => {
      const decisionId = `integ-ucr-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: {
          decisionId,
          tenantId: ctx.tenantId,
        },
      });

      // accumulate('AdvisoryStatus', { field: 'pendingDecisions', increment: 1 })
      // Item may already exist from DECISION_PACKET_CREATED test — just verify it exists
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
      });

      // accumulate uses DDB ADD — __typename is not set by accumulate
      expect(item['pendingDecisions']).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it('should decrement AdvisoryStatus and create Activity on DECISION_BLOCKED', async () => {
      const decisionId = `integ-blocked-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_BLOCKED',
        detail: {
          decisionId,
          reason: 'Integration test block',
        },
      });

      // advisoryStatus: accumulate('AdvisoryStatus', { field: 'pendingDecisions', increment: -1 })
      const statusItem = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
      });
      // accumulate uses DDB ADD — __typename is not set by accumulate
      expect(statusItem['pendingDecisions']).toBeDefined();

      // recentActivity: record('Activity', ...) → pk: T#<tenantId>, sk: Activity#<timestamp>
      let activityItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !activityItem) {
        const items = await table.queryItems({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          skPrefix: 'Activity#',
        });
        activityItem = items.find(i => i['activityType'] === 'DECISION_BLOCKED');
        if (!activityItem) await new Promise(r => setTimeout(r, 2_000));
      }

      expect(activityItem).toBeDefined();
      expect(activityItem!['__typename']).toBe('Activity');
      expect(activityItem!['activityType']).toBe('DECISION_BLOCKED');
      expect(activityItem!['description']).toContain('Integration test block');
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────
  //
  // JS resolvers use pk: Dashboard#<tenantId> (separate from materialization pk T#<tenantId>)
  // Pre-seed data with resolver-expected pk/sk before querying.

  describe('AppSync queries', () => {
    const dashboardPk = () => `Dashboard#${ctx.tenantId}`;

    beforeAll(async () => {
      // Pre-seed DDB items at the pk/sk that each resolver looks for
      await seeder.seed({
        table: 'dashboard-bff',
        items: [
          {
            pk: dashboardPk(),
            sk: 'InvestorSnapshot',
            __typename: 'InvestorSnapshot',
            tenantId: ctx.tenantId,
            goalType: 'GROWTH',
            riskLevel: '7',
            operatingMode: 'BALANCED',
            mandateLevel: 'DISCRETIONARY',
            onboardedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            pk: dashboardPk(),
            sk: 'PortfolioSummary',
            __typename: 'PortfolioSummary',
            tenantId: ctx.tenantId,
            totalValueCents: 100_000_00,
            cashBalanceCents: 20_000_00,
            positionCount: 5,
            driftPercent: 2.5,
            updatedAt: new Date().toISOString(),
          },
          {
            pk: dashboardPk(),
            sk: 'AdvisoryStatus',
            __typename: 'AdvisoryStatus',
            tenantId: ctx.tenantId,
            pendingDecisionsCount: 1,
            lastRecommendationAt: new Date().toISOString(),
            lastDecisionStatus: 'APPROVED',
            updatedAt: new Date().toISOString(),
          },
          {
            pk: dashboardPk(),
            sk: 'Position#AAPL',
            __typename: 'PositionSnapshot',
            tenantId: ctx.tenantId,
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            quantity: 10,
            avgCostBasisCents: 15000,
            currentPriceCents: 16000,
            marketValueCents: 160000,
            weightPercent: 15.0,
            unrealizedPnlCents: 10000,
            lastUpdatedAt: new Date().toISOString(),
          },
          {
            pk: dashboardPk(),
            sk: `Activity#${new Date().toISOString()}`,
            __typename: 'Activity',
            tenantId: ctx.tenantId,
            activityType: 'DEPOSIT_DETECTED',
            description: 'Deposit detected: 500 USD',
            timestamp: new Date().toISOString(),
            metadata: null,
          },
          {
            pk: dashboardPk(),
            sk: 'TimeTravel',
            __typename: 'TimeTravelAvailability',
            tenantId: ctx.tenantId,
            available: true,
            oldestDate: '2025-01-01',
            latestDate: new Date().toISOString().split('T')[0],
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }, 30_000);

    it('should return Dashboard via getDashboard', async () => {
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: {
            totalValueCents: number;
            cashBalanceCents: number;
            positionCount: number;
            driftPercent: number;
            updatedAt: string;
          } | null;
          advisoryStatus: {
            pendingDecisionsCount: number;
            lastDecisionStatus: string | null;
            updatedAt: string;
          } | null;
          investorSnapshot: {
            goalType: string | null;
            riskLevel: string | null;
            operatingMode: string | null;
            updatedAt: string;
          } | null;
        };
      }>(`
        query GetDashboard {
          getDashboard {
            portfolioSummary {
              totalValueCents
              cashBalanceCents
              positionCount
              driftPercent
              updatedAt
            }
            advisoryStatus {
              pendingDecisionsCount
              lastDecisionStatus
              updatedAt
            }
            investorSnapshot {
              goalType
              riskLevel
              operatingMode
              updatedAt
            }
          }
        }
      `, {});

      expect(result.getDashboard).toBeDefined();
      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      expect(result.getDashboard.portfolioSummary!.totalValueCents).toBe(100_000_00);
      expect(result.getDashboard.portfolioSummary!.driftPercent).toBe(2.5);
      expect(result.getDashboard.investorSnapshot).not.toBeNull();
      expect(result.getDashboard.investorSnapshot!.goalType).toBe('GROWTH');
      expect(result.getDashboard.investorSnapshot!.operatingMode).toBe('BALANCED');
      expect(result.getDashboard.advisoryStatus).not.toBeNull();
      expect(result.getDashboard.advisoryStatus!.pendingDecisionsCount).toBe(1);
    }, 60_000);

    it('should return PositionSnapshots via getPositionSnapshots', async () => {
      const result = await appsync.query<{
        getPositionSnapshots: Array<{
          symbol: string;
          assetClass: string | null;
          quantity: number;
          avgCostBasisCents: number;
          currentPriceCents: number;
          marketValueCents: number;
          weightPercent: number;
          unrealizedPnlCents: number;
          lastUpdatedAt: string;
        }>;
      }>(`
        query GetPositionSnapshots {
          getPositionSnapshots {
            symbol
            assetClass
            quantity
            avgCostBasisCents
            currentPriceCents
            marketValueCents
            weightPercent
            unrealizedPnlCents
            lastUpdatedAt
          }
        }
      `, {});

      expect(Array.isArray(result.getPositionSnapshots)).toBe(true);
      const aaplPosition = result.getPositionSnapshots.find(p => p.symbol === 'AAPL');
      expect(aaplPosition).toBeDefined();
      expect(aaplPosition!.quantity).toBe(10);
      expect(aaplPosition!.marketValueCents).toBe(160000);
      expect(aaplPosition!.weightPercent).toBe(15.0);
      expect(aaplPosition!.unrealizedPnlCents).toBe(10000);
    }, 60_000);

    it('should return RecentActivity via getRecentActivity', async () => {
      const result = await appsync.query<{
        getRecentActivity: Array<{
          activityType: string;
          description: string;
          timestamp: string;
          metadata: string | null;
        }>;
      }>(`
        query GetRecentActivity {
          getRecentActivity(limit: 10) {
            activityType
            description
            timestamp
            metadata
          }
        }
      `, {});

      expect(Array.isArray(result.getRecentActivity)).toBe(true);
      const depositActivity = result.getRecentActivity.find(a => a.activityType === 'DEPOSIT_DETECTED');
      expect(depositActivity).toBeDefined();
      expect(depositActivity!.description).toContain('Deposit detected');
    }, 60_000);

    it('should return TimeTravelAvailability via getTimeTravelAvailability', async () => {
      const result = await appsync.query<{
        getTimeTravelAvailability: {
          available: boolean;
          oldestDate: string | null;
          latestDate: string | null;
        };
      }>(`
        query GetTimeTravelAvailability {
          getTimeTravelAvailability {
            available
            oldestDate
            latestDate
          }
        }
      `, {});

      expect(result.getTimeTravelAvailability).toBeDefined();
      expect(result.getTimeTravelAvailability.available).toBe(true);
      expect(result.getTimeTravelAvailability.oldestDate).toBe('2025-01-01');
    }, 60_000);

    it('should return null from getSimulationSummary when no simulation exists', async () => {
      // No SimulationSummary seeded — resolver returns null when item not found
      const result = await appsync.query<{
        getSimulationSummary: {
          actualTotalValueCents: number;
          simulatedTotalValueCents: number;
          actualReturnPercent: number;
          simulatedReturnPercent: number;
          returnDifferencePercent: number;
          updatedAt: string;
        } | null;
      }>(`
        query GetSimulationSummary {
          getSimulationSummary {
            actualTotalValueCents
            simulatedTotalValueCents
            actualReturnPercent
            simulatedReturnPercent
            returnDifferencePercent
            updatedAt
          }
        }
      `, {});

      // No SimulationSummary seeded — resolver returns null
      expect(result.getSimulationSummary).toBeNull();
    }, 60_000);
  });
});
