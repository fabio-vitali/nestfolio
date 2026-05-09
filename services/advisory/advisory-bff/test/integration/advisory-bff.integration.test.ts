import {
  EventBridgeClient,
  CognitoFixture,
  AppSyncClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('advisory-bff', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    // Set up Cognito + AppSync for mutation tests
    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'advisory-bff');

    // Trap captures CDC events from AppSync mutations
    await trap.deploy({
      bus: 'advisory',
      detailType: ['USER_CONFIRMED', 'USER_REJECTED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should materialize DecisionReadModel on DECISION_PACKET_CREATED', async () => {
      const decisionId = `integ-decision-${Date.now()}`;
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 10 }],
          explanation: 'Integration test decision',
          confirmationRequired: true,
        },
      });

      // record('DecisionReadModel', ..., { pk: Decision#<tenantId>#<decisionId>, sk: DecisionReadModel })
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('DecisionReadModel');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['trigger']).toBe('REBALANCE');
      expect(item['status']).toBe('PENDING');
    }, 120_000);

    it('should update status to APPROVED on DECISION_APPROVED', async () => {
      const decisionId = `integ-approve-${Date.now()}`;

      // First create the DecisionReadModel so the conditional update has something to update
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 5 }],
          explanation: 'Fixture for DECISION_APPROVED test',
          confirmationRequired: false,
        },
      });

      await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      // Now send DECISION_APPROVED — update() with condition: attribute_exists(pk)
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // Poll until status flips to APPROVED (waitForItem only checks existence, not value)
      const deadline = Date.now() + 60_000;
      let item: Record<string, unknown> | undefined;
      while (Date.now() < deadline) {
        item = await table.waitForItem({
          table: 'advisory-bff',
          pk: `Decision#${ctx.tenantId}#${decisionId}`,
          sk: 'DecisionReadModel',
          timeoutMs: 5_000,
        });
        if (item['status'] === 'APPROVED') break;
        await new Promise(r => setTimeout(r, 3_000));
      }

      expect(item!['status']).toBe('APPROVED');
    }, 120_000);

    it('should update DecisionSummary to COMPLIANCE_REVIEW on DECISION_PACKET_UPDATED', async () => {
      const decisionId = `integ-updated-${Date.now()}`;

      // Event-driven fixture: DECISION_PACKET_CREATED creates the DecisionSummary
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'GOOG', action: 'BUY', quantity: 3 }],
          explanation: 'Test decision for update',
          confirmationRequired: false,
        },
      });

      // Wait for DecisionSummary to exist
      await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      // Now publish DECISION_PACKET_UPDATED
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // Poll until status changes from PENDING to COMPLIANCE_REVIEW
      let item: Record<string, unknown> = {};
      const d = Date.now() + 60_000;
      while (Date.now() < d) {
        item = await table.waitForItem({
          table: 'advisory-bff', pk: `Decision#${ctx.tenantId}#${decisionId}`, sk: 'DecisionReadModel', timeoutMs: 5_000,
        });
        if (item['status'] === 'COMPLIANCE_REVIEW') break;
        await new Promise(r => setTimeout(r, 2_000));
      }
      expect(item['status']).toBe('COMPLIANCE_REVIEW');
    }, 120_000);

    it('should update DecisionSummary to BLOCKED on DECISION_BLOCKED', async () => {
      const decisionId = `integ-blocked-${Date.now()}`;

      // Event-driven fixture
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'DRIFT',
          proposedTrades: [],
          explanation: 'Test for block',
          confirmationRequired: false,
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_BLOCKED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      let item: Record<string, unknown> = {};
      const d = Date.now() + 60_000;
      while (Date.now() < d) {
        item = await table.waitForItem({
          table: 'advisory-bff', pk: `Decision#${ctx.tenantId}#${decisionId}`, sk: 'DecisionReadModel', timeoutMs: 5_000,
        });
        if (item['status'] === 'BLOCKED') break;
        await new Promise(r => setTimeout(r, 2_000));
      }
      expect(item['status']).toBe('BLOCKED');
    }, 120_000);

    it('should update DecisionSummary to AWAITING_CONFIRMATION on USER_CONFIRMATION_REQUESTED', async () => {
      const decisionId = `integ-ucr-${Date.now()}`;

      // Event-driven fixture
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'DEPOSIT',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 5 }],
          explanation: 'Test for confirmation',
          confirmationRequired: true,
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      let item: Record<string, unknown> = {};
      const d = Date.now() + 60_000;
      while (Date.now() < d) {
        item = await table.waitForItem({
          table: 'advisory-bff', pk: `Decision#${ctx.tenantId}#${decisionId}`, sk: 'DecisionReadModel', timeoutMs: 5_000,
        });
        if (item['status'] === 'AWAITING_CONFIRMATION') break;
        await new Promise(r => setTimeout(r, 2_000));
      }
      expect(item['status']).toBe('AWAITING_CONFIRMATION');
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    it('should confirm decision via confirmDecision mutation', async () => {
      const decisionId = `integ-confirm-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Event-driven fixture: DECISION_PACKET_CREATED + USER_CONFIRMATION_REQUESTED
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 1000 }],
          explanation: 'Integration test decision for confirmation',
          confirmationRequired: true,
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 60_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId },
      });
      // Wait for status to become AWAITING_CONFIRMATION
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          const item = await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 5_000 });
          if (item['status'] === 'AWAITING_CONFIRMATION') break;
          await new Promise(r => setTimeout(r, 2_000));
        }
      }

      // Execute confirmDecision mutation
      const result = await appsync.mutate<{
        confirmDecision: { decisionId: string; status: string; confirmedAt: string };
      }>(`
        mutation ConfirmDecision($decisionId: ID!) {
          confirmDecision(decisionId: $decisionId) {
            decisionId
            status
            confirmedAt
            version
          }
        }
      `, { decisionId });

      expect(result.confirmDecision.status).toBe('CONFIRMED');
      expect(result.confirmDecision.confirmedAt).toBeTruthy();

      // Assert: UserConfirmation record was written to DDB
      const confirmations = await table.queryItems({
        table: 'advisory-bff',
        pk,
        skPrefix: 'UserConfirmation#',
      });
      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      expect(confirmations[0]['__typename']).toBe('UserConfirmation');
      expect(confirmations[0]['decisionId']).toBe(decisionId);

      // Assert: CDC emits USER_CONFIRMED on EventBridge
      const event = await trap.waitForEvent({
        detailType: 'USER_CONFIRMED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('USER_CONFIRMED');
    }, 120_000);

    it('should reject decision via rejectDecision mutation', async () => {
      const decisionId = `integ-reject-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;
      const rejectionReason = 'Integration test rejection reason';

      // Event-driven fixture: DECISION_PACKET_CREATED + USER_CONFIRMATION_REQUESTED
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'GOOG', side: 'SELL', quantityOrAmountCents: 500 }],
          explanation: 'Integration test decision for rejection',
          confirmationRequired: true,
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 60_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId },
      });
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          const item = await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 5_000 });
          if (item['status'] === 'AWAITING_CONFIRMATION') break;
          await new Promise(r => setTimeout(r, 2_000));
        }
      }

      // Execute rejectDecision mutation
      const result = await appsync.mutate<{
        rejectDecision: { decisionId: string; status: string; rejectedAt: string; rejectionReason: string };
      }>(`
        mutation RejectDecision($decisionId: ID!, $reason: String!) {
          rejectDecision(decisionId: $decisionId, reason: $reason) {
            decisionId
            status
            rejectedAt
            rejectionReason
            version
          }
        }
      `, { decisionId, reason: rejectionReason });

      expect(result.rejectDecision.status).toBe('REJECTED');
      expect(result.rejectDecision.rejectedAt).toBeTruthy();
      expect(result.rejectDecision.rejectionReason).toBe(rejectionReason);

      // Assert: UserRejection record was written to DDB
      const rejections = await table.queryItems({
        table: 'advisory-bff',
        pk,
        skPrefix: 'UserRejection#',
      });
      expect(rejections.length).toBeGreaterThanOrEqual(1);
      expect(rejections[0]['__typename']).toBe('UserRejection');
      expect(rejections[0]['decisionId']).toBe(decisionId);
      expect(rejections[0]['rejectionReason']).toBe(rejectionReason);

      // Assert: CDC emits USER_REJECTED on EventBridge
      const event = await trap.waitForEvent({
        detailType: 'USER_REJECTED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('USER_REJECTED');
    }, 120_000);
  });

  // ── AdvisoryStatus in-flight projection ────────────────────────────

  describe('AdvisoryStatus in-flight projection', () => {
    it('trigger event → AdvisoryStatus row created with inFlightCount=1', async () => {
      const pk = `T#${ctx.tenantId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: { tenantId: ctx.tenantId },
      });

      // Wait until the AdvisoryStatus row exists with inFlightCount >= 1.
      // accumulate() does an atomic ADD, so the row may be created by an earlier test in
      // the same tenant context — assert >= 1 rather than == 1.
      let item: Record<string, unknown> = {};
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          item = await table.waitForItem({
            table: 'advisory-bff',
            pk,
            sk: 'AdvisoryStatus',
            timeoutMs: 5_000,
          });
          if (Number(item['inFlightCount']) >= 1) break;
        } catch {
          // item not yet present — keep polling
        }
        await new Promise(r => setTimeout(r, 2_000));
      }

      expect(item['__typename']).toBe('AdvisoryStatus');
      expect(Number(item['inFlightCount'])).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it('trigger then DECISION_PACKET_CREATED → inFlightCount decremented, DecisionReadModel exists', async () => {
      // Use a unique decisionId so DecisionReadModel lookup is unambiguous.
      const decisionId = `integ-inflight-${Date.now()}`;
      const statusPk = `T#${ctx.tenantId}`;
      const decisionPk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Step 1: emit a trigger — increments inFlightCount
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'ORDER_FILLED',
        detail: { tenantId: ctx.tenantId },
      });

      // Step 2: wait until AdvisoryStatus row exists (may already exist from prior test)
      let beforeCount = 0;
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          try {
            const s = await table.waitForItem({
              table: 'advisory-bff',
              pk: statusPk,
              sk: 'AdvisoryStatus',
              timeoutMs: 5_000,
            });
            beforeCount = Number(s['inFlightCount']);
            if (beforeCount >= 1) break;
          } catch {
            // keep polling
          }
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      // Step 3: emit DECISION_PACKET_CREATED — decrements inFlightCount and creates DecisionReadModel
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'ORDER_FILLED',
          proposedTrades: [{ symbol: 'MSFT', action: 'BUY', quantity: 2 }],
          explanation: 'In-flight projection integration test',
          confirmationRequired: false,
        },
      });

      // Step 4: poll until inFlightCount drops below beforeCount
      let afterCount = beforeCount;
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          try {
            const s = await table.waitForItem({
              table: 'advisory-bff',
              pk: statusPk,
              sk: 'AdvisoryStatus',
              timeoutMs: 5_000,
            });
            afterCount = Number(s['inFlightCount']);
            if (afterCount < beforeCount) break;
          } catch {
            // keep polling
          }
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      expect(afterCount).toBeLessThan(beforeCount);

      // Step 5: DecisionReadModel must also exist
      await table.waitForItem({
        table: 'advisory-bff',
        pk: decisionPk,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });
    }, 180_000);

    it('two triggers + one PACKET → inFlightCount decremented by one from peak', async () => {
      const decisionId = `integ-two-triggers-${Date.now()}`;
      const statusPk = `T#${ctx.tenantId}`;

      // Capture current inFlightCount before emitting anything
      let baseCount = 0;
      try {
        const s = await table.waitForItem({
          table: 'advisory-bff',
          pk: statusPk,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        baseCount = Number(s['inFlightCount']);
      } catch {
        // row may not exist yet — treat as 0
      }

      // Emit two triggers
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: { tenantId: ctx.tenantId },
      });
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'ORDER_FILLED',
        detail: { tenantId: ctx.tenantId },
      });

      // Wait until inFlightCount reaches at least baseCount + 2
      const expectedPeak = baseCount + 2;
      let peakCount = 0;
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          try {
            const s = await table.waitForItem({
              table: 'advisory-bff',
              pk: statusPk,
              sk: 'AdvisoryStatus',
              timeoutMs: 5_000,
            });
            peakCount = Number(s['inFlightCount']);
            if (peakCount >= expectedPeak) break;
          } catch {
            // keep polling
          }
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      expect(peakCount).toBeGreaterThanOrEqual(expectedPeak);

      // Emit one DECISION_PACKET_CREATED — should decrement by 1
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'DEPOSIT_DETECTED',
          proposedTrades: [{ symbol: 'TSLA', action: 'BUY', quantity: 1 }],
          explanation: 'Two-trigger integration test',
          confirmationRequired: false,
        },
      });

      // Poll until inFlightCount is exactly peakCount - 1
      const expectedAfter = peakCount - 1;
      let afterCount = peakCount;
      {
        const d = Date.now() + 60_000;
        while (Date.now() < d) {
          try {
            const s = await table.waitForItem({
              table: 'advisory-bff',
              pk: statusPk,
              sk: 'AdvisoryStatus',
              timeoutMs: 5_000,
            });
            afterCount = Number(s['inFlightCount']);
            if (afterCount <= expectedAfter) break;
          } catch {
            // keep polling
          }
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      expect(afterCount).toBe(expectedAfter);
    }, 180_000);
  });
});
