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

// ── Workstream 3 contract ───────────────────────────────────────────────
//
// advisory-bff is now a P1 VERSIONED projection of decision-workflow-ctrl's
// full DecisionPacket row, plus a P3 derived AdvisoryStatus aggregate.
//
//  * Ingress subscribes DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED (full-row
//    CDC snapshots) AND the WS-2 SF-direct cycle-lifecycle events
//    DECISION_CYCLE_STARTED (→ GENERATING, v0) + DECISION_CYCLE_FAILED (→ FAILED, v1),
//    projected onto the same versioned DecisionReadModel row.
//    The old direct status/trigger events (DECISION_APPROVED, DECISION_BLOCKED,
//    USER_CONFIRMATION_REQUESTED, DEPOSIT_DETECTED, ORDER_FILLED, …) are no
//    longer subscribed — their effects arrive folded into the versioned
//    snapshot. Sending them here is a no-op, so those tests are gone.
//
//  * DecisionReadModel is projected verbatim from the CDC subject (the full
//    DecisionPacket NewImage carrying __version/status/trigger/…). The
//    projectVersioned version guard drops out-of-order / stale writes.
//    Degraded CREATEs (no explanation AND no trades) are dropped.
//
//  * AdvisoryStatus.inFlightCount is RECOMPUTED post-commit (advisory-status-
//    projector DDB-stream consumer) as the count of this tenant's non-terminal
//    DecisionReadModel rows (status ∈ {PENDING, AWAITING_CONFIRMATION}).
//
//  * confirm/reject mutations write ONLY the UserConfirmation/UserRejection
//    intent row (lifting taskToken from the readback) and re-emit
//    USER_CONFIRMED/USER_REJECTED via CDC. They no longer write the
//    DecisionReadModel projection — the terminal status arrives later via the
//    versioned projection — so the mutation response is the pre-action
//    (readback) row, NOT a CONFIRMED/REJECTED row.
//
// Envelope: eb.putEvent({ ..., detail }) wraps `detail` as the event SUBJECT
// (see EventBridgeClient.putEvent → detail.subject). The CDC subject in
// production is the full DDB NewImage, so we place ALL row fields (including
// __version) directly in `detail`, and decisionSnapshot reads uow.event.subject.

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

    // Trap captures CDC events re-emitted from the confirm/reject intent rows.
    await trap.deploy({
      bus: 'advisory',
      detailType: ['USER_CONFIRMED', 'USER_REJECTED'],
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── DecisionReadModel: versioned full-row projection ─────────────────

  describe('DecisionReadModel (versioned P1 projection)', () => {
    it('materializes the row on DECISION_PACKET_CREATED (version 1)', async () => {
      const decisionId = `integ-create-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 10 }],
          explanation: 'Integration test decision',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'PENDING' },
      });

      expect(item['__typename']).toBe('DecisionReadModel');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['trigger']).toBe('REBALANCE');
      expect(item['status']).toBe('PENDING');
      expect(Number(item['version'])).toBe(1);
    }, 120_000);

    it('a higher-version DECISION_PACKET_UPDATED lands (UPDATED is the primary status driver)', async () => {
      const decisionId = `integ-update-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Create at version 1 (PENDING).
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 5 }],
          explanation: 'Fixture for versioned UPDATE test',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'PENDING' },
      });

      // Update at version 5 → AWAITING_CONFIRMATION + taskToken.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          __version: 5,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'AWAITING_CONFIRMATION',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 5 }],
          explanation: 'Fixture for versioned UPDATE test',
          confirmationRequired: true,
          taskToken: 'tok-x',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });
      expect(item['status']).toBe('AWAITING_CONFIRMATION');
      expect(Number(item['version'])).toBe(5);
      expect(item['taskToken']).toBe('tok-x');
    }, 120_000);

    it('drops a STALE lower-version DECISION_PACKET_UPDATED (version guard / race immunity)', async () => {
      const decisionId = `integ-stale-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Create at v1.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [{ symbol: 'VTI', action: 'BUY', quantity: 1 }],
          explanation: 'Fixture for stale-drop test',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'PENDING' },
      });

      // Advance to v5 (AWAITING_CONFIRMATION).
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          __version: 5,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'AWAITING_CONFIRMATION',
          proposedTrades: [{ symbol: 'VTI', action: 'BUY', quantity: 1 }],
          explanation: 'Fixture for stale-drop test',
          confirmationRequired: true,
          taskToken: 'tok-stale-5',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });

      // Now send a STALE v2 update (BLOCKED). projectVersioned guards on
      // #__version < :version, so this write must be dropped.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          __version: 2,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'BLOCKED',
          proposedTrades: [{ symbol: 'VTI', action: 'BUY', quantity: 1 }],
          explanation: 'Fixture for stale-drop test',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      // Allow the stale invocation to land + (correctly) be dropped.
      await new Promise((r) => setTimeout(r, 8_000));

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 5_000,
      });
      expect(item['status']).toBe('AWAITING_CONFIRMATION');
      expect(Number(item['version'])).toBe(5);
    }, 120_000);

    it('drops a DEGRADED DECISION_PACKET_CREATED (no explanation AND no trades) — no row materialized', async () => {
      const decisionId = `integ-degraded-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [],
          explanation: '',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      // The decisionSnapshot degraded guard returns undefined → skip(): no row.
      // Give the handler time to run, then assert NO row exists.
      await new Promise((r) => setTimeout(r, 8_000));

      await expect(
        table.waitForItem({
          table: 'advisory-bff',
          pk,
          sk: 'DecisionReadModel',
          timeoutMs: 4_000,
        }),
      ).rejects.toThrow();
    }, 60_000);
  });

  // ── DecisionReadModel: cycle-lifecycle status (WS-2) ─────────────────
  //
  // SF-direct cycle events project a MINIMAL versioned row before any packet
  // exists. The version guard makes this order-agnostic: STARTED(v0)→GENERATING,
  // content CREATED(v1) overwrites, FAILED(v1)→FAILED, late STARTED(v0) dropped.

  describe('DecisionReadModel cycle-status (GENERATING/FAILED, WS-2)', () => {
    it('projects GENERATING (v0) from DECISION_CYCLE_STARTED before any packet exists', async () => {
      const decisionId = `integ-gen-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel',
        timeoutMs: 30_000, match: { status: 'GENERATING' },
      });
      expect(item['__typename']).toBe('DecisionReadModel');
      expect(item['status']).toBe('GENERATING');
      expect(Number(item['version'])).toBe(0);
    }, 120_000);

    it('a content DECISION_PACKET_CREATED (v1) overwrites the GENERATING (v0) row', async () => {
      const decisionId = `integ-gen-overwrite-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'GENERATING' },
      });

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1, tenantId: ctx.tenantId, decisionId, trigger: 'REBALANCE', status: 'PENDING',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 1 }],
          explanation: 'real decision overwrites generating', confirmationRequired: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'PENDING' },
      });
      expect(item['status']).toBe('PENDING');
      expect(Number(item['version'])).toBe(1);
      expect(item['explanation']).toBe('real decision overwrites generating');
    }, 120_000);

    it('DECISION_CYCLE_FAILED (v1) projects FAILED; a late STARTED (v0) is dropped by the guard', async () => {
      const decisionId = `integ-failed-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'GENERATING' },
      });

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_FAILED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'FAILED', __version: 1 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'FAILED' },
      });

      // Late STARTED (v0) after FAILED (v1): the guard (#__version < :version) drops it.
      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await new Promise((r) => setTimeout(r, 8_000));

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 5_000,
      });
      expect(item['status']).toBe('FAILED');
      expect(Number(item['version'])).toBe(1);
    }, 120_000);
  });

  // ── AdvisoryStatus: P3 inFlightCount recompute ───────────────────────
  //
  // Each test uses a FRESH tenant (fresh context) so the recomputed count is
  // deterministic: inFlightCount == number of this tenant's non-terminal
  // DecisionReadModel rows. No trap/Cognito needed here.

  describe('AdvisoryStatus (P3 inFlightCount recompute)', () => {
    it('recomputes inFlightCount = count of non-terminal DecisionReadModel rows', async () => {
      const localCtx = await createIntegrationTestContext();
      const localEb = new EventBridgeClient(localCtx);
      const localTable = new TableAssertions(localCtx);
      const statusPk = `T#${localCtx.tenantId}`;

      try {
        // Project two non-terminal (PENDING) decision rows with distinct ids.
        const d1 = `integ-p3-a-${Date.now()}`;
        const d2 = `integ-p3-b-${Date.now()}`;
        for (const decisionId of [d1, d2]) {
          await localEb.putEvent({
            bus: 'advisory',
            targetService: 'advisory-bff',
            detailType: 'DECISION_PACKET_CREATED',
            detail: {
              __version: 1,
              tenantId: localCtx.tenantId,
              decisionId,
              trigger: 'REBALANCE',
              status: 'PENDING',
              proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 1 }],
              explanation: 'P3 recompute fixture',
              confirmationRequired: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
        }

        // AdvisoryStatus is recomputed post-commit + eventually consistent.
        const item = await localTable.waitForItem({
          table: 'advisory-bff',
          pk: statusPk,
          sk: 'AdvisoryStatus',
          timeoutMs: 60_000,
          predicate: (i) => Number(i['inFlightCount']) === 2,
          description: 'inFlightCount === 2',
        });
        expect(item['__typename']).toBe('AdvisoryStatus');
        expect(Number(item['inFlightCount'])).toBe(2);

        // Move one decision to terminal (CONFIRMED) at a higher version.
        await localEb.putEvent({
          bus: 'advisory',
          targetService: 'advisory-bff',
          detailType: 'DECISION_PACKET_UPDATED',
          detail: {
            __version: 3,
            tenantId: localCtx.tenantId,
            decisionId: d1,
            trigger: 'REBALANCE',
            status: 'CONFIRMED',
            proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 1 }],
            explanation: 'P3 recompute fixture',
            confirmationRequired: true,
            confirmedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });

        const afterItem = await localTable.waitForItem({
          table: 'advisory-bff',
          pk: statusPk,
          sk: 'AdvisoryStatus',
          timeoutMs: 60_000,
          predicate: (i) => Number(i['inFlightCount']) === 1,
          description: 'inFlightCount === 1',
        });
        expect(Number(afterItem['inFlightCount'])).toBe(1);
      } finally {
        await localCtx.cleanup.runAll();
      }
    }, 180_000);
  });

  // ── AppSync mutations: confirm / reject (intent-only) ─────────────────

  describe('AppSync mutations (intent-only confirm/reject)', () => {
    it('confirmDecision writes the UserConfirmation intent row + re-emits USER_CONFIRMED', async () => {
      const decisionId = `integ-confirm-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Drive the projection to AWAITING_CONFIRMATION carrying the taskToken
      // the confirm pre-step lifts onto the intent row.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 1000 }],
          explanation: 'Integration test decision for confirmation',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          __version: 5,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'AWAITING_CONFIRMATION',
          proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantityOrAmountCents: 1000 }],
          explanation: 'Integration test decision for confirmation',
          confirmationRequired: true,
          taskToken: 'tok-confirm',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });

      // The mutation returns the readback (pre-confirmation) row — selection set
      // still includes status/version but we do NOT assert the value is CONFIRMED.
      const result = await appsync.mutate<{
        confirmDecision: { decisionId: string; status: string; confirmedAt: string; version: number };
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

      expect(result.confirmDecision.decisionId).toBe(decisionId);

      // Assert: UserConfirmation intent row written, with the lifted taskToken.
      const confirmations = await table.queryItems({
        table: 'advisory-bff',
        pk,
        skPrefix: 'UserConfirmation#',
      });
      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      expect(confirmations[0]['__typename']).toBe('UserConfirmation');
      expect(confirmations[0]['decisionId']).toBe(decisionId);
      expect(confirmations[0]['taskToken']).toBe('tok-confirm');

      // Assert: CDC re-emits USER_CONFIRMED.
      const event = await trap.waitForEvent({
        detailType: 'USER_CONFIRMED',
        timeoutMs: 30_000,
      });
      expect(event.detailType).toBe('USER_CONFIRMED');
    }, 120_000);

    it('rejectDecision writes the UserRejection intent row + re-emits USER_REJECTED', async () => {
      const decisionId = `integ-reject-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;
      const rejectionReason = 'Integration test rejection reason';

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'PENDING',
          proposedTrades: [{ symbol: 'GOOG', side: 'SELL', quantityOrAmountCents: 500 }],
          explanation: 'Integration test decision for rejection',
          confirmationRequired: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({ table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000 });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_UPDATED',
        detail: {
          __version: 5,
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          status: 'AWAITING_CONFIRMATION',
          proposedTrades: [{ symbol: 'GOOG', side: 'SELL', quantityOrAmountCents: 500 }],
          explanation: 'Integration test decision for rejection',
          confirmationRequired: true,
          taskToken: 'tok-reject',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 30_000,
        match: { status: 'AWAITING_CONFIRMATION' },
      });

      const result = await appsync.mutate<{
        rejectDecision: { decisionId: string; status: string; rejectedAt: string; rejectionReason: string; version: number };
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

      expect(result.rejectDecision.decisionId).toBe(decisionId);

      // Assert: UserRejection intent row written, with reason + lifted taskToken.
      const rejections = await table.queryItems({
        table: 'advisory-bff',
        pk,
        skPrefix: 'UserRejection#',
      });
      expect(rejections.length).toBeGreaterThanOrEqual(1);
      expect(rejections[0]['__typename']).toBe('UserRejection');
      expect(rejections[0]['decisionId']).toBe(decisionId);
      expect(rejections[0]['rejectionReason']).toBe(rejectionReason);
      expect(rejections[0]['taskToken']).toBe('tok-reject');

      // Assert: CDC re-emits USER_REJECTED.
      const event = await trap.waitForEvent({
        detailType: 'USER_REJECTED',
        timeoutMs: 30_000,
      });
      expect(event.detailType).toBe('USER_REJECTED');
    }, 120_000);
  });
});
