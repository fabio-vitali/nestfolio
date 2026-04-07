import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

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
    it('should materialize DecisionSummary on DECISION_PACKET_CREATED', async () => {
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId: `integ-decision-${Date.now()}`,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 10 }],
          explanation: 'Integration test decision',
          confirmationRequired: true,
        },
      });

      // record('DecisionSummary', ...) → pk: T#<tenantId>, sk: DecisionSummary#<eventId>
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('DecisionSummary');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['trigger']).toBe('REBALANCE');
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

      // update('DecisionSummary', { status: 'APPROVED' }, { overrides: { pk: T#<tenantId>, sk: DecisionSummary#<decisionId> } })
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `T#${ctx.tenantId}`,
        sk: `DecisionSummary#${decisionId}`,
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('APPROVED');
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    it('should confirm decision via confirmDecision mutation', async () => {
      const decisionId = `integ-confirm-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Pre-seed a DecisionReadModel so the resolver's UpdateItem can increment version
      await seeder.seed({
        table: 'advisory-bff',
        items: [{
          pk,
          sk: 'DecisionReadModel',
          __typename: 'DecisionReadModel',
          tenantId: ctx.tenantId,
          decisionId,
          status: 'AWAITING_CONFIRMATION',
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 1000 }],
          explanation: 'Integration test decision for confirmation',
          complianceChecks: [],
          agentInvocations: [],
          confirmationRequired: true,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      });

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

      // Pre-seed a DecisionReadModel
      await seeder.seed({
        table: 'advisory-bff',
        items: [{
          pk,
          sk: 'DecisionReadModel',
          __typename: 'DecisionReadModel',
          tenantId: ctx.tenantId,
          decisionId,
          status: 'AWAITING_CONFIRMATION',
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'GOOG', side: 'SELL', quantityOrAmountCents: 500 }],
          explanation: 'Integration test decision for rejection',
          complianceChecks: [],
          agentInvocations: [],
          confirmationRequired: true,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      });

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
