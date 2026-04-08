import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
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

      // Send DECISION_APPROVED — update() uses overrides with pk/sk keyed by decisionId
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // update('DecisionReadModel', { status: 'APPROVED' }, { overrides: { pk: Decision#, sk: DecisionReadModel } })
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('APPROVED');
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
});
