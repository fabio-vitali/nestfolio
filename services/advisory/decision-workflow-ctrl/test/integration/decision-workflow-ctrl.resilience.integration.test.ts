import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
  createTestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
  countItems,
  snapshotState,
  assertEquivalentState,
} from '@nestfolio/integration-testing';

// decision-workflow-ctrl resilience — verifies CallbackIngress (sfn-callback)
// behaviour under SQS at-least-once redelivery and out-of-order arrival.
//
// Post advisory-cycle-agent-precomputation, IP and MI no longer emit
// completion events (they precompute snapshots). Only PE + AN run on per-cycle
// task tokens and emit PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED on success
// and PORTFOLIO_FAILED / NARRATIVE_FAILED on caught error. DWC's
// CallbackIngress consumes these to call states:SendTaskSuccess /
// states:SendTaskFailure.
//
// Each completion handler emits a `record('AgentOutput', ...)` write whose
// default keys are pk=`T#${tenantId}`, sk=`AgentOutput#${eventId}` with a
// ConditionExpression `attribute_not_exists(pk)` — so the framework already
// dedups identical eventIds at the DDB layer. These tests prove the guarantee
// end-to-end.
//
// SF task-token behaviour: the `resumeStateMachine` pipeline calls
// SendTaskSuccess for each callback. The test passes a synthetic taskToken
// that does not correspond to a running SF execution; the AWS SDK throws
// `InvalidToken` / `TaskDoesNotExist`, which the pipeline tolerates as
// "task already resolved" (libs/event-processor/src/pipelines/
// resume-state-machine.ts:48-57). The DDB write happens regardless.
//
// NOT tested: trigger events that start SF executions (MANDATE_SNAPSHOT_CREATED,
// INVESTOR_PROFILE_UPDATED, etc.). Those run a separate path tested in the
// main integration suite, and SF-start idempotency for AWS at-least-once
// redelivery is a LOW-priority known gap (see BACKLOG PARKING LOT, 2026-05-03).

// EventBridge synthetic taskToken — long enough to look like a real SF
// task ARN. The pipeline only checks for presence; SendTaskSuccess fails
// with InvalidToken, which the framework tolerates.
const fakeTaskToken = (label: string) =>
  `ARN-fake-${label}-${randomUUID()}-${'x'.repeat(64)}`;

// ── Idempotency ──────────────────────────────────────────────────────────

describe('decision-workflow-ctrl resilience: idempotency', () => {
  it('duplicate PORTFOLIO_COMPLETED produces a single AgentOutput row', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const eventId = `idemp-pc-${randomUUID()}`;
      const decisionId = `idemp-decision-${randomUUID()}`;
      const detail = {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: fakeTaskToken('pc'),
        agentOutput: { proposedTrades: [] },
      };

      // First publish — handler writes AgentOutput at sk=`AgentOutput#${eventId}`
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'PORTFOLIO_COMPLETED',
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
        detailType: 'PORTFOLIO_COMPLETED',
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
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const decisionId = `idemp-approve-${randomUUID()}`;
      const eventId = `idemp-approve-evt-${randomUUID()}`;
      const subject = {
        ccId: `idemp-approve-cc-${randomUUID()}`,
        decisionPacketId: `idemp-approve-dp-${randomUUID()}`,
        decisionId,
        taskToken: fakeTaskToken('approve'),
        mandateSnapshot: { level: 'ADVISORY' as const, status: 'ACTIVE' as const, operatingMode: 'BALANCED' as const, effectiveDate: '2026-01-01T00:00:00.000Z' },
        status: 'COMPLETED' as const,
        result: 'APPROVED' as const,
        violations: [],
        authorityLevel: 'L2' as const,
        sourceEventId: `idemp-approve-src-${randomUUID()}`,
      };

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'DECISION_APPROVED',
        subject,
        context: { tenantId: ctx.tenantId },
        eventId,
      });

      const first = await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `DecisionPacket#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });
      // Post-w3 (bff-readmodel-w3): the L2 AWAITING_CONFIRMATION status is written
      // SOLELY by the SF RequestUserConfirmation state (single writer). The
      // compliance callback records only the verdict (complianceResult +
      // authorityLevel) + a monotonic __version. No SF runs in this synthetic
      // injection, so status stays absent — assert the verdict fields instead.
      expect(first['complianceResult']).toBe('APPROVED');
      expect(first['authorityLevel']).toBe('L2');
      expect(first['status']).toBeUndefined();

      // Duplicate
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'DECISION_APPROVED',
        subject,
        context: { tenantId: ctx.tenantId },
        eventId,
      });
      await new Promise((r) => setTimeout(r, 10_000));

      const second = await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `DecisionPacket#${ctx.tenantId}#${decisionId}`,
        sk: 'DecisionPacket',
        timeoutMs: 5_000,
      });
      // Same row, same verdict — UpdateItem upsert is idempotent under identical
      // input. __version increments per delivery by design (D1: at-least-once
      // redelivery bumps the version with identical content; the consumer's
      // projectVersioned guard dedupes/orders), so assert verdict-content
      // idempotency + an active counter, not a pinned version.
      expect(second['complianceResult']).toBe('APPROVED');
      expect(second['authorityLevel']).toBe('L2');
      expect(second['status']).toBeUndefined();
      expect(typeof second['__version']).toBe('number');

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
  it('PORTFOLIO_COMPLETED and NARRATIVE_COMPLETED in either order both produce AgentOutput rows', async () => {
    const runOrder = async (
      ctx: Awaited<ReturnType<typeof createTestContext>>,
      ordering: 'portfolio-first' | 'narrative-first',
    ): Promise<{ pcId: string; ncId: string; snapshot: Record<string, unknown>[] }> => {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      const decisionId = `pair-decision-${randomUUID()}`;
      const pcId = `pair-pc-${randomUUID()}`;
      const ncId = `pair-nc-${randomUUID()}`;
      const pcEvent = {
        bus: 'advisory' as const,
        targetService: 'decision-workflow-ctrl',
        detailType: 'PORTFOLIO_COMPLETED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          taskToken: fakeTaskToken('pc'),
          agentOutput: { proposedTrades: [] },
        },
        eventId: pcId,
      };
      const ncEvent = {
        bus: 'advisory' as const,
        targetService: 'decision-workflow-ctrl',
        detailType: 'NARRATIVE_COMPLETED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          taskToken: fakeTaskToken('nc'),
          agentOutput: { explanation: 'narrative body' },
        },
        eventId: ncId,
      };

      if (ordering === 'portfolio-first') {
        await eb.putEvent(pcEvent);
        await eb.putEvent(ncEvent);
      } else {
        await eb.putEvent(ncEvent);
        await eb.putEvent(pcEvent);
      }

      await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
        sk: `AgentOutput#${pcId}`,
        timeoutMs: 60_000,
      });
      await table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `T#${ctx.tenantId}`,
        sk: `AgentOutput#${ncId}`,
        timeoutMs: 60_000,
      });

      const snapshot = await snapshotState(
        table, 'decision-workflow-ctrl', `T#${ctx.tenantId}`, 'AgentOutput#',
      );
      return { pcId, ncId, snapshot };
    };

    const ctxA = await createIntegrationTestContext();
    let snapshotA: Record<string, unknown>[];
    try {
      ({ snapshot: snapshotA } = await runOrder(ctxA, 'portfolio-first'));
      expect(snapshotA.length).toBe(2);
    } finally {
      await ctxA.cleanup.runAll();
    }

    const ctxB = await createIntegrationTestContext();
    let snapshotB: Record<string, unknown>[];
    try {
      ({ snapshot: snapshotB } = await runOrder(ctxB, 'narrative-first'));
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
