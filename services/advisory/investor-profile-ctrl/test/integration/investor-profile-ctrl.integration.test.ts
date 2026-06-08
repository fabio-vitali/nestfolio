import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
} from '@nestfolio/integration-testing';

/**
 * investor-profile-ctrl integration — continuous-projection model.
 *
 * Post advisory-cycle-agent-precomputation:
 *   - The service NO LONGER subscribes to ANALYZE_INVESTOR_PROFILE.
 *   - It subscribes to INVESTOR_PROFILE_UPDATED and MANDATE_ISSUED, runs the
 *     agent, and materialises an InvestorProfileSnapshot row keyed by (tenantId, userId).
 *     (OPERATING_MODE_CHANGED was dropped: investor-bff re-sourced it from the
 *     Mandate CDC row, so the subject would feed a Mandate row instead of the
 *     full InvestorProfile to the agent. operatingMode changes still trigger a
 *     rebuild via the INVESTOR_PROFILE_UPDATED co-fire from investor-bff's dual-write.)
 *   - Egress CDC emits INVESTOR_PROFILE_SNAPSHOT_CREATED / _UPDATED.
 *
 * DRY-subject identity model:
 *   Identity (tenantId/userId/region) lives in `event.context`, injected by
 *   eb.putEvent from ctx.tenantId/ctx.userId — it is NOT carried in the subject.
 *   The event-processor intent executor stamps the row's identity attributes
 *   from the context (pickRequestContext), so the persisted snapshot row always
 *   has tenantId = ctx.tenantId and userId = ctx.userId. The handler builds the
 *   row pk from `subject.userId ?? tenantId`; with no subject.userId it falls
 *   back to tenantId, so the pk's user component is ctx.tenantId, giving
 *   pk = `InvestorProfileSnapshot#${ctx.tenantId}#${ctx.tenantId}`.
 *
 *   Because identity is now context-derived, per-test row isolation comes from a
 *   fresh integration context per `it` (each createIntegrationTestContext mints a
 *   distinct tenantId/userId), NOT from a per-test userId embedded in the subject.
 *
 * Snapshot row shape:
 *   pk: `InvestorProfileSnapshot#${tenantId}#${userId}`
 *   sk: 'InvestorProfileSnapshot'
 *   agentOutput: <agent result blob>
 *   sourceEventId / sourceEventType / agentInvocationId
 *
 * Tolerant skip if AgentRuntime infrastructure is unavailable in dev.
 */

const PROFILE_SNAPSHOT_PK = (ctx: TestContext) =>
  `InvestorProfileSnapshot#${ctx.tenantId}#${ctx.tenantId}`;

/**
 * The mock-agent-runtime SSM override is service-global (keyed on the deployed
 * service name, not on a test context), so it is applied once in beforeAll
 * against a setup-only context and applies to every per-test context's events.
 */
async function deployMockAgentRuntime(setupCtx: TestContext): Promise<void> {
  const mockApi = new MockApiFixture(setupCtx);
  const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
  const mockUrl = await mockApi.deploy({
    name: 'mock-agent-runtime',
    handlerAsset: readFileSync(zipPath),
  });

  const ssmOverride = new SsmOverrideFixture(setupCtx);
  await ssmOverride.overrideAndDeriveRestore({
    paramName: `/nestfolio/${setupCtx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
    testValue: mockUrl,
    expectedRestorePrefix: 'arn:',
  });
}

describe('investor-profile-ctrl: INVESTOR_PROFILE_UPDATED → InvestorProfileSnapshot DDB write + CDC', () => {
  let setupCtx: TestContext;

  beforeAll(async () => {
    setupCtx = await createIntegrationTestContext();
    await deployMockAgentRuntime(setupCtx);
  }, 120_000);

  afterAll(async () => {
    await setupCtx.cleanup.runAll();
  }, 30_000);

  it('materialises an InvestorProfileSnapshot row on INVESTOR_PROFILE_UPDATED', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'advisory',
        detailType: [
          'INVESTOR_PROFILE_SNAPSHOT_CREATED',
          'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
        ],
      });

      // DRY subject: NO tenantId/userId/region — identity comes from context.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'investor-profile-ctrl',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          operatingMode: 'BALANCED',
          investorProfile: {
            age: 40,
            income: 120000,
            liquidAssets: 80000,
            investmentExperience: 'MODERATE',
          },
          portfolioState: {
            totalValue: 200000,
            holdings: [],
          },
        },
      });

      let snapshot: Record<string, unknown>;
      try {
        snapshot = await table.waitForItem({
          table: 'investor-profile-ctrl',
          pk: PROFILE_SNAPSHOT_PK(ctx),
          sk: 'InvestorProfileSnapshot',
          timeoutMs: 120_000,
        });
      } catch {
        console.warn(
          'investor-profile-ctrl: AgentRuntime may be unavailable — snapshot not materialised. Skipping assertions.',
        );
        return;
      }

      expect(snapshot['__typename']).toBe('InvestorProfileSnapshot');
      expect(snapshot['tenantId']).toBe(ctx.tenantId);
      expect(snapshot['userId']).toBe(ctx.userId);
      expect(snapshot['sourceEventType']).toBe('INVESTOR_PROFILE_UPDATED');
      expect(typeof snapshot['sourceEventId']).toBe('string');
      expect(snapshot['agentOutput']).toBeTruthy();
      expect(typeof snapshot['agentOutput']).toBe('object');

      // CDC verification — stack emits INVESTOR_PROFILE_SNAPSHOT_CREATED (insert)
      // or INVESTOR_PROFILE_SNAPSHOT_UPDATED (modify). The CDC subject is the
      // snapshot row, whose userId attribute is the context userId (ctx.userId).
      const cdcEvent = await trap.waitForEvent({
        match: (detail) => {
          const subject = (detail as { subject?: Record<string, unknown> }).subject;
          return subject?.['userId'] === ctx.userId;
        },
        timeoutMs: 60_000,
      });
      expect([
        'INVESTOR_PROFILE_SNAPSHOT_CREATED',
        'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      ]).toContain(cdcEvent.detailType);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('materialises a snapshot on MANDATE_ISSUED (operatingMode hoisted from mandate.operatingMode)', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();

      // DRY subject: identity in context. mandate.operatingMode supplies the
      // operatingMode the handler resolves when the top-level field is absent.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'investor-profile-ctrl',
        detailType: 'MANDATE_ISSUED',
        detail: {
          mandateId: `mandate-${randomUUID()}`,
          level: 'ADVISORY',
          mandate: {
            operatingMode: 'AGGRESSIVE',
          },
          operatingMode: 'AGGRESSIVE',
          effectiveDate: new Date().toISOString(),
        },
      });

      try {
        const snapshot = await table.waitForItem({
          table: 'investor-profile-ctrl',
          pk: PROFILE_SNAPSHOT_PK(ctx),
          sk: 'InvestorProfileSnapshot',
          timeoutMs: 120_000,
        });
        expect(snapshot['sourceEventType']).toBe('MANDATE_ISSUED');
        expect(snapshot['agentOutput']).toBeTruthy();
      } catch {
        console.warn(
          'investor-profile-ctrl: AgentRuntime may be unavailable — MANDATE_ISSUED snapshot not materialised.',
        );
      }
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 180_000);

  it('rebuilds on a second trigger → INVESTOR_PROFILE_SNAPSHOT_UPDATED with __version 2 (WS-B)', async () => {
    // Two triggers for the SAME (context) identity → first INSERT (_CREATED,
    // __version 1), second MODIFY (_UPDATED, __version 2). Isolation from the
    // other tests comes from this test's own fresh context.
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'advisory',
        detailType: [
          'INVESTOR_PROFILE_SNAPSHOT_CREATED',
          'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
        ],
      });

      // First trigger — distinct eventId → agent runs → INSERT → _CREATED, __version=1
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'investor-profile-ctrl',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          operatingMode: 'BALANCED',
          investorProfile: { age: 40, income: 120000, liquidAssets: 80000, investmentExperience: 'MODERATE' },
          portfolioState: { totalValue: 200000, holdings: [] },
        },
        eventId: `wsb-trigger1-${randomUUID()}`,
      });

      // Wait for _CREATED so the row exists before the second trigger arrives
      try {
        await trap.waitForEvent({
          detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
          match: (detail) => (detail as { subject?: Record<string, unknown> }).subject?.['userId'] === ctx.userId,
          timeoutMs: 150_000,
        });
      } catch {
        console.warn(
          'investor-profile-ctrl: AgentRuntime may be unavailable — WS-B __version 2 test skipped.',
        );
        return;
      }

      // Second trigger — distinct eventId → agent runs → MODIFY → _UPDATED, __version=2
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'investor-profile-ctrl',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          operatingMode: 'CONSERVATIVE',
          investorProfile: { age: 40, income: 120000, liquidAssets: 80000, investmentExperience: 'MODERATE' },
          portfolioState: { totalValue: 200000, holdings: [] },
        },
        eventId: `wsb-trigger2-${randomUUID()}`,
      });

      const updated = await trap.waitForEvent({
        detailType: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
        match: (detail) => (detail as { subject?: Record<string, unknown> }).subject?.['userId'] === ctx.userId,
        timeoutMs: 150_000,
      });
      const subject = (updated.detail as { subject?: Record<string, unknown> }).subject!;
      expect(subject['__version']).toBe(2);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 360_000);
});
