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

describe('dashboard-bff', () => {
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
    it('should materialize InvestorSnapshot on INVESTOR_PROFILE_CREATED (composite payload)', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'INVESTOR_PROFILE_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          goal: { objective: 'GROWTH', targetAmountCents: 500_000_00 },
          riskProfile: { score: 7 },
          operatingMode: 'BALANCED',
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'InvestorSnapshot',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('InvestorSnapshot');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['goalType']).toBe('GROWTH');
      expect(item['riskLevel']).toBe('7');
      expect(item['operatingMode']).toBe('BALANCED');
      expect(item['onboardedAt']).toBeDefined();
    }, 120_000);

    it('should update InvestorSnapshot fields on INVESTOR_PROFILE_UPDATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          goal: { objective: 'INCOME', targetAmountCents: 1_000_000_00 },
          riskProfile: { score: 9 },
          operatingMode: 'AGGRESSIVE',
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
        if (item['goalType'] === 'INCOME' && item['riskLevel'] === '9' && item['operatingMode'] === 'AGGRESSIVE') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['goalType']).toBe('INCOME');
      expect(item!['riskLevel']).toBe('9');
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

    it('should NOT increment AdvisoryStatus on DECISION_PACKET_CREATED (Phase 2: trigger-driven)', async () => {
      // Phase 2: pendingDecisionsCount is now incremented by SF trigger events (ORDER_*, DEPOSIT_DETECTED, etc.)
      // DECISION_PACKET_CREATED no longer increments — it only records activity.
      const decisionId = `integ-dp-created-${Date.now()}`;

      // Read current value before sending event
      let beforeValue = 0;
      try {
        const before = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 2_000,
        });
        beforeValue = (before['pendingDecisionsCount'] as number) ?? 0;
      } catch { /* item doesn't exist yet */ }

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

      // Wait for any side effects to settle, then assert count did NOT change
      await new Promise(r => setTimeout(r, 5_000));
      let afterValue = beforeValue;
      try {
        const after = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 2_000,
        });
        afterValue = (after['pendingDecisionsCount'] as number) ?? 0;
      } catch { /* item doesn't exist */ }

      expect(afterValue).toBe(beforeValue);
    }, 60_000);

    it('should NOT increment AdvisoryStatus on USER_CONFIRMATION_REQUESTED (Phase 2: was double-count)', async () => {
      // Phase 2: USER_CONFIRMATION_REQUESTED no longer increments — it only records activity.
      const decisionId = `integ-ucr-${Date.now()}`;

      let beforeValue = 0;
      try {
        const before = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 2_000,
        });
        beforeValue = (before['pendingDecisionsCount'] as number) ?? 0;
      } catch { /* item doesn't exist yet */ }

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: {
          decisionId,
          tenantId: ctx.tenantId,
        },
      });

      // Wait for any side effects to settle, then assert count did NOT change
      await new Promise(r => setTimeout(r, 5_000));
      let afterValue = beforeValue;
      try {
        const after = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 2_000,
        });
        afterValue = (after['pendingDecisionsCount'] as number) ?? 0;
      } catch { /* item doesn't exist */ }

      expect(afterValue).toBe(beforeValue);
    }, 60_000);

    it('should decrement AdvisoryStatus and create Activity on DECISION_BLOCKED', async () => {
      const decisionId = `integ-blocked-${Date.now()}`;

      // Read current value before sending event
      const before = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 5_000,
      });
      const beforeValue = (before['pendingDecisionsCount'] as number) ?? 0;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_BLOCKED',
        detail: {
          decisionId,
          reason: 'Integration test block',
        },
      });

      // Poll until pendingDecisions decrements
      let statusItem: Record<string, unknown> | undefined;
      const statusDeadline = Date.now() + 60_000;
      while (Date.now() < statusDeadline) {
        statusItem = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        if ((statusItem['pendingDecisionsCount'] as number) < beforeValue) break;
        await new Promise(r => setTimeout(r, 2_000));
      }
      expect((statusItem!['pendingDecisionsCount'] as number)).toBe(beforeValue - 1);

      // recentActivity: record('Activity', ...) → pk: T#<tenantId>, sk: Activity#<eventId>
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
  // JS resolvers use pk: T#<tenantId> — same as materializeToTable pipeline.
  // All state populated via EventBridge events processed by event-listener.
  // Prior event materialization tests already wrote items for this tenant;
  // the beforeAll below publishes a fresh round of events to set explicit
  // query-test state and waits for materialization before running queries.

  describe('AppSync queries', () => {
    const querySnapshotAt = new Date().toISOString();

    beforeAll(async () => {
      // 1. InvestorSnapshot — project() uses PutItem (full replace), so only the
      //    LAST event's fields survive. Send INVESTOR_PROFILE_UPDATED as the final
      //    InvestorSnapshot event; assert only its fields in the query test.
      // Detail shape mirrors the CDC envelope investor-bff emits — see
      // services/investor/dashboard-bff/src/transforms/investor-snapshot.ts:
      //   payload.goal.objective → goalType
      //   payload.riskProfile.score → riskLevel (stringified)
      //   payload.operatingMode (string) → operatingMode
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          goal: { objective: 'RETIREMENT' },
          riskProfile: { score: 6 },
          operatingMode: 'BALANCED',
        },
      });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const snapshot = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'InvestorSnapshot',
          timeoutMs: 5_000,
        });
        if (snapshot['operatingMode'] === 'BALANCED') break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      // 2. Independent events in parallel — each writes to a distinct sk
      await Promise.all([
        // PortfolioSummary (driftPercent via project)
        eb.putEvent({
          bus: 'investor',
          targetService: 'dashboard-bff',
          detailType: 'PORTFOLIO_UPDATED',
          detail: { driftPercent: 2.5 },
        }),
        // PositionSnapshot#MSFT via project
        eb.putEvent({
          bus: 'investor',
          targetService: 'dashboard-bff',
          detailType: 'PORTFOLIO_UPDATED',
          detail: {
            symbol: 'MSFT',
            quantity: 20,
            avgCostBasis: 300,
            currentPrice: 320,
            marketValue: 6400,
            weightPercent: 25,
            unrealizedPnl: 400,
            assetClass: 'EQUITY',
          },
        }),
        // TimeTravelAvailability via project
        eb.putEvent({
          bus: 'investor',
          targetService: 'dashboard-bff',
          detailType: 'LEDGER_ENTRY_RECORDED',
          detail: { snapshotAt: querySnapshotAt, entryType: 'TRADE' },
        }),
      ]);

      // 3. AdvisoryStatus + Activity — DECISION_APPROVED decrements pendingDecisions,
      //    so a trigger event (Phase 2: ORDER_FILLED) must increment first.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ORDER_FILLED',
        detail: {
          orderId: `query-test-order-${Date.now()}`,
          symbol: 'MSFT',
          quantity: 5,
          filledPrice: 300,
        },
      });
      // Wait for AdvisoryStatus to exist before sending DECISION_APPROVED
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          try {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'AdvisoryStatus', timeoutMs: 5_000,
            });
            if ((item['pendingDecisionsCount'] as number) >= 1) break;
          } catch { /* not yet */ }
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_APPROVED',
        detail: { decisionId: 'query-test-approved' },
      });

      // Wait for all parallel items to materialize
      await Promise.all([
        // PortfolioSummary
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PortfolioSummary', timeoutMs: 5_000,
            });
            if (item['driftPercent'] === 2.5) return;
            await new Promise(r => setTimeout(r, 2_000));
          }
        })(),
        // PositionSnapshot#MSFT
        table.waitForItem({
          table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PositionSnapshot#MSFT', timeoutMs: 60_000,
        }),
        // TimeTravelAvailability
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'TimeTravelAvailability', timeoutMs: 5_000,
            });
            if (item['snapshotAt'] === querySnapshotAt) return;
            await new Promise(r => setTimeout(r, 2_000));
          }
        })(),
        // Activity — poll until DECISION_APPROVED activity appears
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const items = await table.queryItems({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, skPrefix: 'Activity#',
            });
            if (items.some(i => i['activityType'] === 'DECISION_APPROVED'
              && (i['description'] as string)?.includes('query-test-approved'))) return;
            await new Promise(r => setTimeout(r, 2_000));
          }
        })(),
      ]);
    }, 300_000);

    it('should default missing PortfolioSummary Int! fields to 0 (regression: e2e step-8 fresh tenant)', async () => {
      // PortfolioSummary row exists with only driftPercent + updatedAt populated
      // (a freshly-onboarded tenant who has not yet had any orders filled). The
      // schema declares totalValueCents/cashBalanceCents/positionCount as Int!,
      // so a naive resolver that returns the raw DDB item would cause AppSync
      // to null-coerce the parent object — failing getDashboard for the e2e.
      // get-dashboard.fn.js fills 0 defaults for the missing Int!/Float! fields.
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: {
            totalValueCents: number;
            cashBalanceCents: number;
            positionCount: number;
            driftPercent: number;
            updatedAt: string;
          } | null;
        };
      }>(`
        query GetDashboardFull {
          getDashboard {
            portfolioSummary {
              totalValueCents
              cashBalanceCents
              positionCount
              driftPercent
              updatedAt
            }
          }
        }
      `, {});

      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      const ps = result.getDashboard.portfolioSummary!;
      expect(ps.totalValueCents).toBe(0);
      expect(ps.cashBalanceCents).toBe(0);
      expect(ps.positionCount).toBe(0);
      expect(ps.driftPercent).toBe(2.5);
      expect(typeof ps.updatedAt).toBe('string');
      expect(ps.updatedAt.length).toBeGreaterThan(0);
    }, 60_000);

    it('should return Dashboard via getDashboard', async () => {
      // portfolioSummary: project() writes driftPercent + updatedAt (no totalValueCents/cashBalanceCents/positionCount)
      // advisoryStatus: accumulate() writes pendingDecisions only (field name != schema pendingDecisionsCount)
      // investorSnapshot: project() writes goalType, riskLevel, operatingMode + updatedAt
      //
      // Query only fields that exist in DDB. Requesting Int! fields absent from
      // the item causes AppSync to null-coerce the parent object.
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: {
            driftPercent: number;
          } | null;
          advisoryStatus: Record<string, unknown> | null;
          investorSnapshot: {
            goalType: string | null;
            riskLevel: string | null;
            operatingMode: string | null;
          } | null;
        };
      }>(`
        query GetDashboard {
          getDashboard {
            portfolioSummary {
              driftPercent
            }
            investorSnapshot {
              goalType
              riskLevel
              operatingMode
            }
          }
        }
      `, {});

      expect(result.getDashboard).toBeDefined();

      // portfolioSummary — only driftPercent is populated by the event
      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      expect(result.getDashboard.portfolioSummary!.driftPercent).toBe(2.5);

      // investorSnapshot — project() uses PutItem (full replace), so only the last
      // event's fields survive. INVESTOR_PROFILE_UPDATED was sent last.
      // investor-snapshot transform: goal.objective → goalType,
      // riskProfile.score → riskLevel (stringified), operatingMode passthrough.
      expect(result.getDashboard.investorSnapshot).not.toBeNull();
      expect(result.getDashboard.investorSnapshot!.goalType).toBe('RETIREMENT');
      expect(result.getDashboard.investorSnapshot!.riskLevel).toBe('6');
      expect(result.getDashboard.investorSnapshot!.operatingMode).toBe('BALANCED');
    }, 60_000);

    it('should return PositionSnapshots via getPositionSnapshots', async () => {
      // Transform converts float prices to cents: avgCostBasis=300 → 30000, etc.
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
          }
        }
      `, {});

      expect(Array.isArray(result.getPositionSnapshots)).toBe(true);
      const msftPosition = result.getPositionSnapshots.find(p => p.symbol === 'MSFT');
      expect(msftPosition).toBeDefined();
      expect(msftPosition!.quantity).toBe(20);
      expect(msftPosition!.avgCostBasisCents).toBe(30000);   // 300 * 100
      expect(msftPosition!.currentPriceCents).toBe(32000);   // 320 * 100
      expect(msftPosition!.marketValueCents).toBe(640000);    // 6400 * 100
      expect(msftPosition!.weightPercent).toBe(25);
      expect(msftPosition!.unrealizedPnlCents).toBe(40000);  // 400 * 100
      expect(msftPosition!.assetClass).toBe('EQUITY');
    }, 60_000);

    it('should return RecentActivity via getRecentActivity', async () => {
      // DECISION_APPROVED → activityType='DECISION_APPROVED', description='Decision approved: query-test-approved'
      const result = await appsync.query<{
        getRecentActivity: Array<{
          activityType: string;
          description: string;
        }>;
      }>(`
        query GetRecentActivity {
          getRecentActivity(limit: 20) {
            activityType
            description
          }
        }
      `, {});

      expect(Array.isArray(result.getRecentActivity)).toBe(true);
      const approvedActivity = result.getRecentActivity.find(
        a => a.activityType === 'DECISION_APPROVED' && a.description.includes('query-test-approved'),
      );
      expect(approvedActivity).toBeDefined();
      expect(approvedActivity!.description).toBe('Decision approved: query-test-approved');
    }, 60_000);

    it('should return TimeTravelAvailability via getTimeTravelAvailability', async () => {
      const result = await appsync.query<{
        getTimeTravelAvailability: {
          available: boolean;
          latestDate: string | null;
        };
      }>(`
        query GetTimeTravelAvailability {
          getTimeTravelAvailability {
            available
            latestDate
          }
        }
      `, {});

      expect(result.getTimeTravelAvailability).toBeDefined();
      expect(result.getTimeTravelAvailability.available).toBe(true);
      expect(result.getTimeTravelAvailability.latestDate).toEqual(expect.any(String));
    }, 60_000);

    it('should return null from getSimulationSummary when no simulation exists', async () => {
      // No simulation events published — resolver returns null when item not found
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

      expect(result.getSimulationSummary).toBeNull();
    }, 60_000);
  });

  // ── AdvisoryStatus Phase 2: trigger-driven pendingDecisionsCount ────────
  //
  // Phase 2 shifts the counter from "packet-created" semantics to "SF trigger"
  // semantics. The counter now increments on the 7 SF trigger events and
  // decrements only on DECISION_APPROVED / DECISION_BLOCKED.

  describe('AdvisoryStatus pendingDecisionsCount (Phase 2)', () => {
    it('increments pendingDecisionsCount on DEPOSIT_DETECTED (trigger)', async () => {
      let beforeValue = 0;
      try {
        const before = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 2_000,
        });
        beforeValue = (before['pendingDecisionsCount'] as number) ?? 0;
      } catch { /* item may not exist */ }

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: { tenantId: ctx.tenantId, amountCents: 100_00, currency: 'USD' },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        if ((item['pendingDecisionsCount'] as number) > beforeValue) break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect((item!['pendingDecisionsCount'] as number)).toBe(beforeValue + 1);
    }, 120_000);

    it('increments pendingDecisionsCount on ORDER_FILLED (trigger)', async () => {
      const before = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 5_000,
      });
      const beforeValue = (before['pendingDecisionsCount'] as number) ?? 0;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ORDER_FILLED',
        detail: { tenantId: ctx.tenantId, orderId: `integ-order-${Date.now()}`, symbol: 'AAPL', quantity: 5, filledPrice: 150 },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        if ((item['pendingDecisionsCount'] as number) > beforeValue) break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect((item!['pendingDecisionsCount'] as number)).toBe(beforeValue + 1);
    }, 120_000);

    it('decrements pendingDecisionsCount on DECISION_APPROVED', async () => {
      // First increment via a trigger event to ensure there's something to decrement
      const beforeTrigger = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 5_000,
      });
      const beforeValue = (beforeTrigger['pendingDecisionsCount'] as number) ?? 0;

      // Increment via ORDER_REJECTED trigger
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ORDER_REJECTED',
        detail: { tenantId: ctx.tenantId, orderId: `integ-reject-${Date.now()}`, reason: 'Insufficient funds' },
      });

      // Wait for increment
      let afterIncrement: Record<string, unknown> | undefined;
      const incrDeadline = Date.now() + 60_000;
      while (Date.now() < incrDeadline) {
        afterIncrement = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        if ((afterIncrement['pendingDecisionsCount'] as number) > beforeValue) break;
        await new Promise(r => setTimeout(r, 2_000));
      }
      const incrementedValue = (afterIncrement!['pendingDecisionsCount'] as number);

      // Now decrement via DECISION_APPROVED
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_APPROVED',
        detail: { tenantId: ctx.tenantId, decisionId: `integ-approved-phase2-${Date.now()}` },
      });

      let item: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        if ((item['pendingDecisionsCount'] as number) < incrementedValue) break;
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect((item!['pendingDecisionsCount'] as number)).toBe(incrementedValue - 1);
    }, 120_000);
  });
});
