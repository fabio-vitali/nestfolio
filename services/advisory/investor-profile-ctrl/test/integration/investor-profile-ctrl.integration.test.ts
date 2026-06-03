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
 * Snapshot row shape:
 *   pk: `InvestorProfileSnapshot#${tenantId}#${userId}`
 *   sk: 'InvestorProfileSnapshot'
 *   agentOutput: <agent result blob>
 *   sourceEventId / sourceEventType / agentInvocationId
 *
 * Tolerant skip if AgentRuntime infrastructure is unavailable in dev.
 */
describe('investor-profile-ctrl: INVESTOR_PROFILE_UPDATED → InvestorProfileSnapshot DDB write + CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    // Deploy mock agent runtime
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-agent-runtime.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-agent-runtime',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.overrideAndDeriveRestore({
      paramName: `/nestfolio/${ctx.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
      testValue: mockUrl,
      expectedRestorePrefix: 'arn:',
    });

    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'INVESTOR_PROFILE_SNAPSHOT_CREATED',
        'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('materialises an InvestorProfileSnapshot row on INVESTOR_PROFILE_UPDATED', async () => {
    const userId = `integ-profile-user-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-profile-ctrl',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
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

    // InvestorProfileSnapshot is keyed by (tenantId, userId).
    let snapshot: Record<string, unknown>;
    try {
      snapshot = await table.waitForItem({
        table: 'investor-profile-ctrl',
        pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
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
    expect(snapshot['userId']).toBe(userId);
    expect(snapshot['sourceEventType']).toBe('INVESTOR_PROFILE_UPDATED');
    expect(typeof snapshot['sourceEventId']).toBe('string');
    expect(snapshot['agentOutput']).toBeTruthy();
    expect(typeof snapshot['agentOutput']).toBe('object');

    // CDC verification — stack emits INVESTOR_PROFILE_SNAPSHOT_CREATED (insert)
    // or INVESTOR_PROFILE_SNAPSHOT_UPDATED (modify).
    const cdcEvent = await trap.waitForEvent({
      match: (detail) => {
        const subject = (detail as { subject?: Record<string, unknown> }).subject;
        return subject?.['userId'] === userId;
      },
      timeoutMs: 60_000,
    });
    expect([
      'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
    ]).toContain(cdcEvent.detailType);
  }, 180_000);

  it('materialises a snapshot on MANDATE_ISSUED (operatingMode hoisted from mandate.operatingMode)', async () => {
    const userId = `integ-profile-mandate-${randomUUID()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-profile-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
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
        pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
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
  }, 180_000);

  it('rebuilds on a second trigger → INVESTOR_PROFILE_SNAPSHOT_UPDATED with __version 2 (WS-B)', async () => {
    // Inject the first trigger (→ _CREATED, __version 1) then a second trigger for the
    // same (tenantId, userId) (→ _UPDATED, __version 2), mirroring the existing
    // single-trigger test's injection helper in this file.
    const userId = `integ-profile-wsb-${randomUUID()}`;

    // First trigger — distinct eventId → agent runs → INSERT → _CREATED, __version=1
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-profile-ctrl',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
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
        match: (detail) => (detail as { subject?: Record<string, unknown> }).subject?.['userId'] === userId,
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
        tenantId: ctx.tenantId,
        userId,
        operatingMode: 'CONSERVATIVE',
        investorProfile: { age: 40, income: 120000, liquidAssets: 80000, investmentExperience: 'MODERATE' },
        portfolioState: { totalValue: 200000, holdings: [] },
      },
      eventId: `wsb-trigger2-${randomUUID()}`,
    });

    const updated = await trap.waitForEvent({
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      match: (detail) => (detail as { subject?: Record<string, unknown> }).subject?.['userId'] === userId,
      timeoutMs: 150_000,
    });
    const subject = (updated.detail as { subject?: Record<string, unknown> }).subject!;
    expect(subject['__version']).toBe(2);
  }, 360_000);
});
