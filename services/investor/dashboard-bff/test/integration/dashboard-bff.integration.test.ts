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
        // Mirrors investor-bff's full-row CDC subject: monotonic __version + the
        // stable onboardingCompletedAt are present on every INVESTOR_PROFILE_* emit.
        detail: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          goal: { objective: 'GROWTH', targetAmountCents: 500_000_00 },
          riskProfile: { score: 7 },
          operatingMode: 'BALANCED',
          onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
          __version: 1,
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
        // __version 2 > the CREATED row's 1 → the version guard accepts this update.
        detail: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          goal: { objective: 'INCOME', targetAmountCents: 1_000_000_00 },
          riskProfile: { score: 9 },
          operatingMode: 'AGGRESSIVE',
          onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
          __version: 2,
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'InvestorSnapshot',
        timeoutMs: 60_000,
        match: { goalType: 'INCOME', riskLevel: '9', operatingMode: 'AGGRESSIVE' },
      });

      expect(item!['__typename']).toBe('InvestorSnapshot');
      expect(item!['goalType']).toBe('INCOME');
      expect(item!['riskLevel']).toBe('9');
      expect(item!['operatingMode']).toBe('AGGRESSIVE');
    }, 120_000);

    it('should materialize PortfolioSummary on PORTFOLIO_UPDATED (ledger snapshot)', async () => {
      // w2: portfolioSummary is now a P1 version-guarded projection from the ledger snapshot.
      // The transform reads event.subject.snapshot and requires snapshot.cashBalanceCents.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          cashBalanceCents: 80000,
          snapshot: {
            cashBalanceCents: 80000,
            lastEventSequence: 42,
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 160 },
            },
          },
        },
      });

      // projectVersioned('PortfolioSummary', ...) → pk: T#<tenantId>, sk: PortfolioSummary
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 60_000,
        predicate: (i) => i['__version'] === 42,
      });

      expect(item['__typename']).toBe('PortfolioSummary');
      expect(item['tenantId']).toBe(ctx.tenantId);
      // cashBalanceCents: from snapshot
      expect(item['cashBalanceCents']).toBe(80000);
      // positionCount: Object.keys(positions).length = 1
      expect(item['positionCount']).toBe(1);
      // totalValueCents: cashBalanceCents + round(10 * 160 * 100) = 80000 + 160000 = 240000
      expect(item['totalValueCents']).toBe(240000);
      // __version: Number(lastEventSequence) = 42
      expect(item['__version']).toBe(42);
    }, 120_000);

    it('should materialize PositionSnapshot on PORTFOLIO_UPDATED (with symbol in snapshot.positions)', async () => {
      // w2: positionSnapshot is now a P1 version-guarded projection from snapshot.positions.
      // One row per holding; dollar-denominated fields converted to cents.
      // Reuses the same snapshot published in the PortfolioSummary test above (seq=42, AAPL).
      const symbol = 'AAPL';

      // The prior test already sent the AAPL snapshot (seq=42). Wait for that row to appear.
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: `PositionSnapshot#${symbol}`,
        timeoutMs: 60_000,
        predicate: (i) => i['__version'] === 42,
      });

      expect(item['__typename']).toBe('PositionSnapshot');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['symbol']).toBe(symbol);
      expect(item['assetClass']).toBe('EQUITY');
      expect(item['quantity']).toBe(10);
      // avgCostBasisCents: round(150 * 100) = 15000
      expect(item['avgCostBasisCents']).toBe(15000);
      // currentPriceCents: round(160 * 100) = 16000
      expect(item['currentPriceCents']).toBe(16000);
      // marketValueCents: round(10 * 160 * 100) = 160000
      expect(item['marketValueCents']).toBe(160000);
      // unrealizedPnlCents: 160000 - round(1500 * 100) = 160000 - 150000 = 10000
      expect(item['unrealizedPnlCents']).toBe(10000);
      // weightPercent: 100 (only position)
      expect(item['weightPercent']).toBe(100);
      // __version: 42
      expect(item['__version']).toBe(42);
    }, 120_000);

    it('should handle RECONCILIATION_COMPLETED via portfolioSummary (no-op without snapshot)', async () => {
      // RECONCILIATION_COMPLETED goes through portfolioSummary transform.
      // Without snapshot.cashBalanceCents the transform returns undefined → no write.
      // Verify the PortfolioSummary row from the prior test is not overwritten.
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

      // Prior PORTFOLIO_UPDATED test (seq=42) wrote PortfolioSummary with __version=42.
      // RECONCILIATION_COMPLETED (no snapshot) should NOT have overwritten it.
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 5_000,
      }).catch(() => undefined);

      if (item) {
        // If the row exists it must still be the snapshot-projected row (version=42)
        expect(item['__version']).toBe(42);
        expect(item['cashBalanceCents']).toBe(80000);
      }
    }, 30_000);

    it('should materialize TimeTravelAvailability on LEDGER_ENTRY_RECORDED', async () => {
      const snapshotAt = new Date().toISOString();

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          // Mirror the producer's LedgerEntryRecorded contract: tenantId + snapshot
          // are required on the subject (snapshot-to-events.ts emits them), and
          // snapshotAt is now carried top-level for the TimeTravel projection.
          tenantId: ctx.tenantId,
          snapshotAt,
          entryType: 'TRADE',
          // WS-C: TimeTravelAvailability is now projectVersioned keyed on
          // subject.lastEventSequence (the real LEDGER_ENTRY_RECORDED carries it).
          lastEventSequence: 10,
          snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 10 },
        },
      });

      // projectVersioned('TimeTravelAvailability', …) → pk: T#<tenantId>, sk: TimeTravelAvailability
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

    it('should materialize Activity record on DECISION_BLOCKED (no AdvisoryStatus mutation)', async () => {
      // Workstream 3: DECISION_BLOCKED no longer touches AdvisoryStatus (the
      // accumulate path is gone). It still dispatches to recentActivity, so the
      // only materialization to assert here is the Activity row.
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

    it('broadcasts publishActivityUpdate on DEPOSIT_DETECTED (Activity row carries inbound eventId)', async () => {
      // dashboard-publisher dispatches on DDB stream INSERT of an Activity row
      // and fires publishActivityUpdate (NONE data source → onActivityUpdate
      // subscribers). The Activity row's activityId is set by recent-activity.ts
      // from the inbound EventBridge envelope's `event.id`, which is what
      // EventBridgeClient.putEvent stores in `detail.id` when passed `eventId`.
      //
      // Integration scope here is the outcome: the Activity row materializes
      // with the EXACT activityId we supplied. That linkage is what the e2e
      // layer (DashboardPage.waitForActivityByEventId) uses to deterministically
      // match the broadcast frame to the originating event in step-9 of the
      // happy-path journey. The AppSync subscription frame itself is asserted
      // at the Playwright/e2e layer, not here.
      const eventId = `integ-activity-broadcast-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DEPOSIT_DETECTED',
        eventId,
        detail: { tenantId: ctx.tenantId, amountCents: 250_00, currency: 'USD' },
      });

      let activityItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !activityItem) {
        const items = await table.queryItems({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          skPrefix: 'Activity#',
        });
        activityItem = items.find(i => i['activityId'] === eventId);
        if (!activityItem) await new Promise(r => setTimeout(r, 2_000));
      }

      expect(activityItem).toBeDefined();
      expect(activityItem!['__typename']).toBe('Activity');
      expect(activityItem!['activityId']).toBe(eventId);
      expect(activityItem!['activityType']).toBe('DEPOSIT_DETECTED');
      expect(activityItem!['tenantId']).toBe(ctx.tenantId);
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
      // 1. InvestorSnapshot — projectVersioned() does a version-guarded full-row
      //    PutItem, so the HIGHEST-__version event's fields survive. Send
      //    INVESTOR_PROFILE_UPDATED with __version 3 (> the event-materializations
      //    block's 1/2 on the shared T#<tenant> row) as the final InvestorSnapshot
      //    event; assert only its fields in the query test.
      // Detail shape mirrors the CDC envelope investor-bff emits — see
      // services/investor/dashboard-bff/src/transforms/investor-snapshot.ts:
      //   payload.goal.objective → goalType
      //   payload.riskProfile.score → riskLevel (stringified)
      //   payload.operatingMode (string) → operatingMode
      //   payload.onboardingCompletedAt → onboardedAt; payload.__version → version guard
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          goal: { objective: 'RETIREMENT' },
          riskProfile: { score: 6 },
          operatingMode: 'BALANCED',
          onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
          __version: 3,
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
      // w2: PortfolioSummary + PositionSnapshot now use snapshot-shaped events.
      // MSFT snapshot: qty=20, averageCostBasis=300, totalCostBasis=6000, lastFillPrice=320
      //   → avgCostBasisCents=30000, currentPriceCents=32000, marketValueCents=640000
      //   → unrealizedPnlCents=640000-600000=40000, weightPercent=100 (only holding)
      // PortfolioSummary (same event): cashBalanceCents=50000, positionCount=1,
      //   totalValueCents=50000+640000=690000, __version=50
      await Promise.all([
        // PortfolioSummary + PositionSnapshot#MSFT from one snapshot event (P1)
        eb.putEvent({
          bus: 'investor',
          targetService: 'dashboard-bff',
          detailType: 'PORTFOLIO_UPDATED',
          detail: {
            cashBalanceCents: 50000,
            snapshot: {
              cashBalanceCents: 50000,
              lastEventSequence: 50,
              positions: {
                MSFT: { symbol: 'MSFT', quantity: 20, averageCostBasis: 300, totalCostBasis: 6000, lastFillPrice: 320 },
              },
            },
          },
        }),
        // TimeTravelAvailability via projectVersioned (WS-C). lastEventSequence
        // must exceed the earlier direct-test write (10) so the shared
        // T#<tenant> row's version guard accepts this newer snapshotAt.
        eb.putEvent({
          bus: 'investor',
          targetService: 'dashboard-bff',
          detailType: 'LEDGER_ENTRY_RECORDED',
          detail: {
            tenantId: ctx.tenantId,
            snapshotAt: querySnapshotAt,
            entryType: 'TRADE',
            lastEventSequence: 100,
            snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 100 },
          },
        }),
      ]);

      // 3. AdvisoryStatus — W3: projected from advisory-bff's authoritative
      //    ADVISORY_STATUS_UPDATED announcement (inFlightCount → pendingDecisionsCount),
      //    version-guarded. No longer accumulated from trigger events.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ADVISORY_STATUS_UPDATED',
        detail: { tenantId: ctx.tenantId, inFlightCount: 2, __version: 900 },
      });
      // 4. Activity — DECISION_APPROVED still dispatches to recentActivity.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'DECISION_APPROVED',
        detail: { decisionId: 'query-test-approved' },
      });

      // Wait for all parallel items to materialize
      await Promise.all([
        // PortfolioSummary — wait for the snapshot-projected row (__version=50)
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PortfolioSummary', timeoutMs: 5_000,
            });
            if (item['__version'] === 50) return;
            await new Promise(r => setTimeout(r, 2_000));
          }
        })(),
        // PositionSnapshot#MSFT — wait for the snapshot-projected row (__version=50)
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'PositionSnapshot#MSFT', timeoutMs: 5_000,
            }).catch(() => undefined);
            if (item && item['__version'] === 50) return;
            await new Promise(r => setTimeout(r, 2_000));
          }
        })(),
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
        // AdvisoryStatus — wait for the projected announcement (__version=900)
        (async () => {
          const d = Date.now() + 60_000;
          while (Date.now() < d) {
            const item = await table.waitForItem({
              table: 'dashboard-bff', pk: `T#${ctx.tenantId}`, sk: 'AdvisoryStatus', timeoutMs: 5_000,
            }).catch(() => undefined);
            if (item && item['__version'] === 900) return;
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

    it('should return real PortfolioSummary fields from snapshot projection', async () => {
      // w2: PortfolioSummary is now a full-row P1 snapshot projection — no structural zeros.
      // The beforeAll published a snapshot with cashBalanceCents=50000, 1 MSFT position
      // (marketValueCents=640000), so totalValueCents=690000, positionCount=1.
      // get-dashboard.fn.js returns the actual projected values (no || 0 papering).
      // driftPercent was removed from the schema in w2 — no longer selectable.
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: {
            totalValueCents: number;
            cashBalanceCents: number;
            positionCount: number;
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
              updatedAt
            }
          }
        }
      `, {});

      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      const ps = result.getDashboard.portfolioSummary!;
      // Real snapshot-projected values, not zeros
      expect(ps.cashBalanceCents).toBe(50000);
      expect(ps.positionCount).toBe(1);
      // totalValueCents: cashBalanceCents + round(20 * 320 * 100) = 50000 + 640000 = 690000
      expect(ps.totalValueCents).toBe(690000);
      expect(typeof ps.updatedAt).toBe('string');
      expect(ps.updatedAt.length).toBeGreaterThan(0);
    }, 60_000);

    it('should return Dashboard via getDashboard', async () => {
      // portfolioSummary: w2 snapshot projection writes totalValueCents/cashBalanceCents/positionCount
      // advisoryStatus: W3 P3 projection writes pendingDecisionsCount from inFlightCount
      // investorSnapshot: project() writes goalType, riskLevel, operatingMode + updatedAt
      const result = await appsync.query<{
        getDashboard: {
          portfolioSummary: {
            totalValueCents: number;
            cashBalanceCents: number;
            positionCount: number;
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
              totalValueCents
              cashBalanceCents
              positionCount
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

      // portfolioSummary — snapshot-projected values from beforeAll (seq=50, MSFT)
      expect(result.getDashboard.portfolioSummary).not.toBeNull();
      expect(result.getDashboard.portfolioSummary!.cashBalanceCents).toBe(50000);
      expect(result.getDashboard.portfolioSummary!.positionCount).toBe(1);
      expect(result.getDashboard.portfolioSummary!.totalValueCents).toBe(690000);

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
      // beforeAll published MSFT snapshot: qty=20, averageCostBasis=300, totalCostBasis=6000, lastFillPrice=320
      // Transform (dollar → cents): avgCostBasisCents=30000, currentPriceCents=32000,
      //   marketValueCents=round(20*320*100)=640000, unrealizedPnlCents=640000-round(6000*100)=40000
      // weightPercent=100 (MSFT is the only holding in this snapshot).
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
      expect(msftPosition!.avgCostBasisCents).toBe(30000);    // round(300 * 100)
      expect(msftPosition!.currentPriceCents).toBe(32000);    // round(320 * 100)
      expect(msftPosition!.marketValueCents).toBe(640000);    // round(20 * 320 * 100)
      expect(msftPosition!.weightPercent).toBe(100);          // MSFT is the sole holding
      expect(msftPosition!.unrealizedPnlCents).toBe(40000);   // 640000 - round(6000 * 100)
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

  // ── AdvisoryStatus (Workstream 3): P3 projection of advisory-bff's aggregate ──
  //
  // AdvisoryStatus is no longer accumulated from disparate trigger events. It is a
  // P3 projection of advisory-bff's authoritative ADVISORY_STATUS_UPDATED
  // announcement (forwarded advisory→investor by investor-adpt). The transform maps
  // the producer's `inFlightCount` → the read model's `pendingDecisionsCount` and is
  // version-guarded on `__version`: an idempotent overwrite, NOT an accumulate.

  describe('AdvisoryStatus pendingDecisionsCount (P3 projection)', () => {
    it('projects the announced aggregate (counts + oldest generating)', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ADVISORY_STATUS_UPDATED',
        detail: {
          tenantId: ctx.tenantId, inFlightCount: 3, generatingCount: 1, failedCount: 0,
          oldestGeneratingAt: '2026-06-05T09:00:00.000Z', __version: 1_000,
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
        predicate: (i) => i['__version'] === 1_000,
      });

      expect(item['__typename']).toBe('AdvisoryStatus');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['pendingDecisionsCount']).toBe(3);
      expect(item['generatingCount']).toBe(1);
      expect(item['failedCount']).toBe(0);
      expect(item['oldestGeneratingAt']).toBe('2026-06-05T09:00:00.000Z');
      expect(item['__version']).toBe(1_000);
    }, 120_000);

    it('drops a stale (lower-version) announcement and keeps the newest', async () => {
      // Project version 50 with inFlightCount=9.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ADVISORY_STATUS_UPDATED',
        detail: { tenantId: ctx.tenantId, inFlightCount: 9, __version: 1_050 },
      });
      await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'AdvisoryStatus',
        timeoutMs: 60_000,
        predicate: (i) => i['__version'] === 1_050,
      });

      // A lower-version announcement must be dropped by the version guard.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'ADVISORY_STATUS_UPDATED',
        detail: { tenantId: ctx.tenantId, inFlightCount: 1, __version: 4 },
      });
      await new Promise((r) => setTimeout(r, 6_000));
      for (let i = 0; i < 6; i++) {
        const item = await table.waitForItem({
          table: 'dashboard-bff',
          pk: `T#${ctx.tenantId}`,
          sk: 'AdvisoryStatus',
          timeoutMs: 30_000,
        });
        expect(item['__version']).toBe(1_050);
        expect(item['pendingDecisionsCount']).toBe(9);
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }, 180_000);
  });
});
