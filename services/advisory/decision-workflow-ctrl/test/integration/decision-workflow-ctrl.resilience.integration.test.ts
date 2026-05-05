import { randomUUID } from 'node:crypto';
import {
  createTestContext,
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  TableAssertions,
  countItems,
  snapshotState,
  assertEquivalentState,
} from '@nestfolio/integration-testing';

// decision-workflow-ctrl resilience — verifies CallbackIngress (sfn-callback)
// behaviour under SQS at-least-once redelivery and out-of-order arrival.
//
// Tested ingress: agent completion events (INVESTOR_PROFILE_COMPLETED,
// MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED).
// Each handler emits a `record('AgentOutput', ...)` write whose default
// keys are pk=`T#${tenantId}`, sk=`AgentOutput#${eventId}` with a
// ConditionExpression `attribute_not_exists(pk)` — so the framework already
// dedups identical eventIds at the DDB layer. These tests prove the
// guarantee end-to-end.
//
// SF task-token behaviour: the `resumeStateMachine` pipeline calls
// SendTaskSuccess for each callback. The test passes a synthetic taskToken
// that does not correspond to a running SF execution; the AWS SDK throws
// `InvalidToken` / `TaskDoesNotExist`, which the pipeline tolerates as
// "task already resolved" (libs/event-processor/src/pipelines/
// resume-state-machine.ts:48-57). The DDB write happens regardless.
//
// NOT tested: trigger events that start SF executions (INVESTOR_PROFILE_CREATED
// etc.). Those run a separate path tested in the main integration suite,
// and SF-start idempotency for AWS at-least-once redelivery is a
// LOW-priority known gap (see BACKLOG PARKING LOT, 2026-05-03).

// EventBridge synthetic taskToken — long enough to look like a real SF
// task ARN. The pipeline only checks for presence; SendTaskSuccess fails
// with InvalidToken, which the framework tolerates.
const fakeTaskToken = (label: string) =>
  `ARN-fake-${label}-${randomUUID()}-${'x'.repeat(64)}`;

// ── Idempotency ──────────────────────────────────────────────────────────

describe('decision-workflow-ctrl resilience: idempotency', () => {
  it('duplicate INVESTOR_PROFILE_COMPLETED produces a single AgentOutput row', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-ipc-${randomUUID()}`;
      const decisionId = `idemp-decision-${randomUUID()}`;
      const detail = {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: fakeTaskToken('ipc'),
      };

      // First publish — handler writes AgentOutput at sk=`AgentOutput#${eventId}`
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'INVESTOR_PROFILE_COMPLETED',
        detail,
        eventId,
      });

      // Wait for the AgentOutput row to land
      await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
        sk: `AgentOutput#${eventId}`,
        timeoutMs: 60_000,
      });

      const countBefore = await countItems(
        table, 'decision-workflow-ctrl', `T#${ctx.tenantId}`, 'AgentOutput#',
      );
      expect(countBefore).toBe(1);

      // Duplicate publish (same eventId) — record() conditional fails →
      // intent-executor returns deduplicated, no second row
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'INVESTOR_PROFILE_COMPLETED',
        detail,
        eventId,
      });

      await new Promise((r) => setTimeout(r, 15_000));

      const countAfter = await countItems(
        table, 'decision-workflow-ctrl', `T#${ctx.tenantId}`, 'AgentOutput#',
      );
      expect(countAfter).toBe(countBefore);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('duplicate DECISION_APPROVED leaves DecisionPacket idempotent (UpdateItem upsert)', async () => {
    const ctx = await createTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const decisionId = `idemp-approve-${randomUUID()}`;
      const eventId = `idemp-approve-evt-${randomUUID()}`;
      const detail = {
        tenantId: ctx.tenantId,
        decisionId,
        authorityLevel: 'L2',
        taskToken: fakeTaskToken('approve'),
      };

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'DECISION_APPROVED',
        detail,
        eventId,
      });

      const first = await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `DecisionPacket#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });
      expect(first['status']).toBe('AWAITING_CONFIRMATION');

      // Duplicate
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'DECISION_APPROVED',
        detail,
        eventId,
      });
      await new Promise((r) => setTimeout(r, 10_000));

      const second = await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `DecisionPacket#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionPacket',
        timeoutMs: 5_000,
      });
      // Same row, same status — UpdateItem upsert is idempotent under
      // identical input (no compliance race conditions for this test).
      expect(second['status']).toBe('AWAITING_CONFIRMATION');
      expect(second['authorityLevel']).toBe('L2');

      // Still exactly one DecisionPacket row for this decisionId
      const count = await countItems(
        table, 'decision-workflow-ctrl', `DecisionPacket#${ctx.tenantId}#${decisionId}`,
      );
      expect(count).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);
});

// ── Order-Agnostic ──────────────────────────────────────────────────────
// Two distinct agent completion events arriving in either order both write
// independent AgentOutput rows. Run A and Run B should reach equivalent
// final-state shape (snapshot equality after stripping dynamic fields).

describe('decision-workflow-ctrl resilience: order-agnostic', () => {
  it('INVESTOR_PROFILE_COMPLETED and MARKET_ANALYSIS_COMPLETED in either order both produce AgentOutput rows', async () => {
    const runOrder = async (
      ctx: Awaited<ReturnType<typeof createTestContext>>,
      ordering: 'profile-first' | 'market-first',
    ): Promise<{ ipcId: string; macId: string; snapshot: Record<string, unknown>[] }> => {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const decisionId = `pair-decision-${randomUUID()}`;
      const ipcId = `pair-ipc-${randomUUID()}`;
      const macId = `pair-mac-${randomUUID()}`;
      const ipcEvent = {
        bus: 'advisory' as const,
        targetService: 'decision-workflow-ctrl',
        detailType: 'INVESTOR_PROFILE_COMPLETED',
        detail: { tenantId: ctx.tenantId, decisionId, taskToken: fakeTaskToken('ipc') },
        eventId: ipcId,
      };
      const macEvent = {
        bus: 'advisory' as const,
        targetService: 'decision-workflow-ctrl',
        detailType: 'MARKET_ANALYSIS_COMPLETED',
        detail: { tenantId: ctx.tenantId, decisionId, taskToken: fakeTaskToken('mac') },
        eventId: macId,
      };

      if (ordering === 'profile-first') {
        await eb.putEvent(ipcEvent);
        await eb.putEvent(macEvent);
      } else {
        await eb.putEvent(macEvent);
        await eb.putEvent(ipcEvent);
      }

      await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
        sk: `AgentOutput#${ipcId}`,
        timeoutMs: 60_000,
      });
      await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
        sk: `AgentOutput#${macId}`,
        timeoutMs: 60_000,
      });

      const snapshot = await snapshotState(
        table, 'decision-workflow-ctrl', `T#${ctx.tenantId}`, 'AgentOutput#',
      );
      return { ipcId, macId, snapshot };
    };

    const ctxA = await createTestContext();
    let snapshotA: Record<string, unknown>[];
    try {
      ({ snapshot: snapshotA } = await runOrder(ctxA, 'profile-first'));
      expect(snapshotA.length).toBe(2);
    } finally {
      await ctxA.cleanup.runAll();
    }

    const ctxB = await createTestContext();
    let snapshotB: Record<string, unknown>[];
    try {
      ({ snapshot: snapshotB } = await runOrder(ctxB, 'market-first'));
      expect(snapshotB.length).toBe(2);
    } finally {
      await ctxB.cleanup.runAll();
    }

    // Drop per-run identifiers (decisionId differs per run) before comparing.
    const cleanA = snapshotA.map(({ decisionId: _d, ...rest }) => rest);
    const cleanB = snapshotB.map(({ decisionId: _d, ...rest }) => rest);
    assertEquivalentState(cleanA, cleanB);
  }, 240_000);
});
