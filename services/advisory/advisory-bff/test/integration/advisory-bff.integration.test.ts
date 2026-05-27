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
        timeoutMs: 30_000,
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
        timeoutMs: 30_000,
      });

      // Now send DECISION_APPROVED — update() with condition: attribute_exists(pk).
      // authorityLevel: 'L1' is the autonomous-execute path (no user confirm); this
      // event is the terminal compliance state. Post-2026-05-26 race fix, the
      // transform discriminates L1/L2 on this subject field; pass it explicitly.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          authorityLevel: 'L1',
        },
      });

      // Wait for status flip to APPROVED (single primitive call replaces outer poll loop)
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'APPROVED' },
      });

      expect(item['status']).toBe('APPROVED');
    }, 120_000);

    // 2026-05-26 L2 race regression (plan: docs/superpowers/plans/2026-05-26-advisory-bff-approved-to-awaiting-race.md).
    // For L2 decisions, compliance-ctrl emits DECISION_APPROVED (authorityLevel=L2)
    // AND decision-workflow-ctrl SF emits USER_CONFIRMATION_REQUESTED. Both land
    // in advisory-bff as independent Lambda invocations with no ordering
    // guarantee — if DECISION_APPROVED's write lands last, badge sticks on APPROVED
    // and Confirm button never appears. Pre-fix, both orderings could resolve to
    // APPROVED depending on Lambda completion order; post-fix, DECISION_APPROVED
    // is a no-op for L2 and the final status is deterministically
    // AWAITING_CONFIRMATION regardless of order.
    it('L2 race: DECISION_APPROVED then USER_CONFIRMATION_REQUESTED — final status=AWAITING_CONFIRMATION', async () => {
      const decisionId = `integ-l2-race-aprbefore-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'VTI', action: 'BUY', quantity: 1 }],
          explanation: 'L2 race fixture (APPROVED first)',
          confirmationRequired: true,
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: { tenantId: ctx.tenantId, decisionId, authorityLevel: 'L2' },
      });
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId, taskToken: 'tok-l2-race-a' },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });
      expect(item['status']).toBe('AWAITING_CONFIRMATION');
    }, 120_000);

    it('L2 race: USER_CONFIRMATION_REQUESTED then DECISION_APPROVED — final status=AWAITING_CONFIRMATION', async () => {
      const decisionId = `integ-l2-race-confbefore-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'VTI', action: 'BUY', quantity: 1 }],
          explanation: 'L2 race fixture (USER_CONFIRMATION_REQUESTED first)',
          confirmationRequired: true,
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId, taskToken: 'tok-l2-race-b' },
      });
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: { tenantId: ctx.tenantId, decisionId, authorityLevel: 'L2' },
      });

      // The interesting assertion: 30s window to let any racing APPROVED write
      // land — final state must remain AWAITING_CONFIRMATION.
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 60_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });
      expect(item['status']).toBe('AWAITING_CONFIRMATION');

      // Defensive: re-read after 5s in case DECISION_APPROVED's invocation was
      // cold-starting at first read. Status must still be AWAITING_CONFIRMATION
      // (no late-arrival overwrite).
      await new Promise((r) => setTimeout(r, 5_000));
      const followUp = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 5_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });
      expect(followUp['status']).toBe('AWAITING_CONFIRMATION');
    }, 180_000);

    // DECISION_PACKET_UPDATED is a deliberate no-op for status — see
    // transforms/decision-status-changed.ts:11-17 (Bug E fix, 2026-05-24). SF
    // emits DECISION_PACKET_UPDATED after compliance returns terminal
    // APPROVED/BLOCKED; both fan out to advisory-bff. Mapping UPDATED to any
    // intermediate status would race the terminal write. This test guards
    // against re-introducing such a mapping.
    it('should NOT change DecisionSummary status on DECISION_PACKET_UPDATED (no-op by design)', async () => {
      const decisionId = `integ-updated-${Date.now()}`;

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

      await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'PENDING' },
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // Allow handler invocation to complete (SQS → Lambda → no-op return)
      await new Promise((r) => setTimeout(r, 10_000));

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 5_000,
      });
      expect(item['status']).toBe('PENDING');
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
        timeoutMs: 30_000,
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

      // Wait for status flip to BLOCKED (single primitive call replaces outer poll loop)
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'BLOCKED' },
      });
      expect(item['status']).toBe('BLOCKED');
    }, 120_000);

    it('should land at BLOCKED when DECISION_BLOCKED arrives before DECISION_PACKET_CREATED (out-of-order delivery)', async () => {
      const decisionId = `integ-blocked-oo-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Step 1: emit DECISION_BLOCKED before any DECISION_PACKET_CREATED.
      // With update({condition: attribute_exists(pk)}) this would be silently
      // swallowed as deduplicated: true; with updateOrRetry() it throws
      // ConditionalCheckFailed and SQS redrives the message.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_BLOCKED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // Step 2: brief wait so DECISION_BLOCKED is in flight (and presumably
      // already threw ConditionalCheckFailed → RetryablePreconditionError),
      // then emit DECISION_PACKET_CREATED.
      await new Promise((r) => setTimeout(r, 5_000));

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'DRIFT',
          proposedTrades: [],
          explanation: 'Test for out-of-order BLOCKED',
          confirmationRequired: false,
        },
      });

      // Step 3: assert the row exists AND eventually flips to BLOCKED via the
      // redelivered DECISION_BLOCKED. timeoutMs must cover at least one SQS
      // redrive cycle: the advisory-bff IngressQueue has VisibilityTimeout
      // = 180s (verified 2026-05-24 via aws sqs get-queue-attributes), so
      // the first redelivery of the BLOCKED message happens ~180s after the
      // initial fail. 240s = 180s visibility + 60s processing/buffer.
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 240_000,
        match: { status: 'BLOCKED' },
      });
      expect(item['status']).toBe('BLOCKED');
    }, 360_000);

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
        timeoutMs: 30_000,
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

      // Wait for status flip to AWAITING_CONFIRMATION (single primitive call replaces outer poll loop)
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `Decision#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });
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
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId },
      });
      // Wait for status to become AWAITING_CONFIRMATION (single primitive call replaces outer poll loop)
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
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
        timeoutMs: 30_000,
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
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'USER_CONFIRMATION_REQUESTED',
        detail: { tenantId: ctx.tenantId, decisionId },
      });
      // Wait for status to become AWAITING_CONFIRMATION (single primitive call replaces outer poll loop)
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
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
        timeoutMs: 30_000,
      });
      expect(event.detailType).toBe('USER_REJECTED');
    }, 120_000);
  });

  // ── AdvisoryStatus in-flight projection ────────────────────────────

  describe('AdvisoryStatus in-flight projection', () => {
    it('trigger event → AdvisoryStatus row inFlightCount incremented', async () => {
      const pk = `T#${ctx.tenantId}`;

      // Capture baseline before emitting — counter may already be negative from orphan-PACKET
      // tests on the shared tenant (accepted spec §8 E1 edge case).
      let baseCount = 0;
      try {
        const s = await table.waitForItem({
          table: 'advisory-bff',
          pk,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        baseCount = Number(s['inFlightCount'] ?? 0);
      } catch {
        // row not yet present — treat as 0
      }

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: { tenantId: ctx.tenantId },
      });

      // Wait until inFlightCount exceeds baseline (single primitive call replaces outer poll loop)
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'AdvisoryStatus',
        timeoutMs: 30_000,
        predicate: (i) => Number(i['inFlightCount']) > baseCount,
        description: `Number(inFlightCount) > ${baseCount}`,
      });

      expect(item['__typename']).toBe('AdvisoryStatus');
      expect(Number(item['inFlightCount'])).toBeGreaterThan(baseCount);
    }, 120_000);

    it('trigger then DECISION_PACKET_CREATED → inFlightCount decremented, DecisionReadModel exists', async () => {
      // Use a unique decisionId so DecisionReadModel lookup is unambiguous.
      const decisionId = `integ-inflight-${Date.now()}`;
      const statusPk = `T#${ctx.tenantId}`;
      const decisionPk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Capture baseline before emitting — counter may already be negative from orphan-PACKET
      // tests on the shared tenant (accepted spec §8 E1 edge case).
      let baseCount = 0;
      try {
        const s = await table.waitForItem({
          table: 'advisory-bff',
          pk: statusPk,
          sk: 'AdvisoryStatus',
          timeoutMs: 5_000,
        });
        baseCount = Number(s['inFlightCount'] ?? 0);
      } catch {
        // row not yet present — treat as 0
      }

      // Step 1: emit a trigger — increments inFlightCount
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'ORDER_FILLED',
        detail: { tenantId: ctx.tenantId },
      });

      // Step 2: wait until inFlightCount exceeds baseline (single primitive call replaces outer poll loop)
      const beforeItem = await table.waitForItem({
        table: 'advisory-bff',
        pk: statusPk,
        sk: 'AdvisoryStatus',
        timeoutMs: 30_000,
        predicate: (i) => Number(i['inFlightCount']) > baseCount,
        description: `Number(inFlightCount) > ${baseCount}`,
      });
      const beforeCount = Number(beforeItem['inFlightCount']);
      expect(beforeCount).toBeGreaterThan(baseCount);

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

      // Step 4: poll until inFlightCount drops below beforeCount (single primitive call replaces outer poll loop)
      const afterItem = await table.waitForItem({
        table: 'advisory-bff',
        pk: statusPk,
        sk: 'AdvisoryStatus',
        timeoutMs: 30_000,
        predicate: (i) => Number(i['inFlightCount']) < beforeCount,
        description: `Number(inFlightCount) < ${beforeCount}`,
      });
      const afterCount = Number(afterItem['inFlightCount']);
      expect(afterCount).toBeLessThan(beforeCount);

      // Step 5: DecisionReadModel must also exist
      await table.waitForItem({
        table: 'advisory-bff',
        pk: decisionPk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
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

      // Wait until inFlightCount reaches at least baseCount + 2 (single primitive call replaces outer poll loop)
      const expectedPeak = baseCount + 2;
      const peakItem = await table.waitForItem({
        table: 'advisory-bff',
        pk: statusPk,
        sk: 'AdvisoryStatus',
        timeoutMs: 30_000,
        predicate: (i) => Number(i['inFlightCount']) >= expectedPeak,
        description: `Number(inFlightCount) >= ${expectedPeak}`,
      });
      const peakCount = Number(peakItem['inFlightCount']);
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

      // Poll until inFlightCount is exactly peakCount - 1 (single primitive call replaces outer poll loop)
      const expectedAfter = peakCount - 1;
      const afterItem = await table.waitForItem({
        table: 'advisory-bff',
        pk: statusPk,
        sk: 'AdvisoryStatus',
        timeoutMs: 30_000,
        predicate: (i) => Number(i['inFlightCount']) <= expectedAfter,
        description: `Number(inFlightCount) <= ${expectedAfter}`,
      });
      const afterCount = Number(afterItem['inFlightCount']);
      expect(afterCount).toBe(expectedAfter);
    }, 180_000);
  });
});
