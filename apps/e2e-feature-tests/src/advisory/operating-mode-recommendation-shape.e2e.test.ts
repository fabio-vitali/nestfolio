import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withProfileSnapshot,
  bffClient,
  type FreshTenant,
} from '..';
import { EventBridgeClient } from '@nestfolio/test-support';

/**
 * Phase 2 done-when: same trigger event yields mode-differentiated proposedTrades shape.
 *
 * Spec: docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md
 *
 * Flow per mode:
 *   1. onboarded({ operatingMode: <mode> }) — composite InvestorProfile row carries the mode.
 *   2. Inline MANDATE_ISSUED publish carrying the desired operatingMode — the
 *      natural chain materialises a MandateSnapshot row in
 *      decision-workflow-ctrl's local table → CDC emits MANDATE_SNAPSHOT_CREATED →
 *      SF starts and reads operatingMode via Direct DDB GetItem
 *      (LookupMandateSnapshot). withLiveDecision could be used too with the
 *      `operatingMode` option, but inline keeps the test self-contained.
 *   3. SF starts, runs the 4-agent pipeline (investor-profile → market-intelligence
 *      → portfolio-engine → advisory-narrative → assemble → compliance → end).
 *   4. Wait for advisory-bff getDecision to surface a packet with non-empty proposedTrades.
 *   5. Derive equityWeight + largestPositionWeight from proposedTrades and assert
 *      they fall within the mode envelope.
 *
 * Mode envelopes (from spec §Step 6, clarified 2026-05-06):
 *   CONSERVATIVE  count ≤ 5,  equityWeight ≤ 0.30, largest EQUITY position ≤ 0.10
 *   BALANCED      count 5-8,  equityWeight 0.50-0.70, largest EQUITY position ≤ 0.15
 *   AGGRESSIVE    count ≥ 6,  equityWeight ≥ 0.70, largest EQUITY position ≤ 0.25
 *
 * `largestPositionWeight` constraint applies only to allocations whose
 * assetClass === 'EQUITY' — broad bond ETFs and cash equivalents may exceed
 * the cap because they are diversified by construction.
 *
 * Tolerances are wide because LLM output is non-deterministic. If a mode fails
 * a single run, re-run before declaring failure — see §Risk register in the spec.
 */

const POLL_INTERVAL_MS = 5_000;
// 360s budget per case: the chain runs four LangGraph agents sequentially,
// CONSERVATIVE/AGGRESSIVE add Approach B mode-aware validation-feedback retries
// (~12s each, up to 3 attempts), and portfolio-engine waits up to ~28s on
// AgentCore Memory read-after-write. BALANCED satisfies validation on the
// first attempt and finishes well within this budget.
const PACKET_TIMEOUT_MS = 360_000;
const CASES = [
  {
    mode: 'CONSERVATIVE' as const,
    maxCount: 5,
    maxEquityWeight: 0.30,
    maxLargestPosition: 0.10,
    minEquityWeight: 0,
  },
  {
    mode: 'BALANCED' as const,
    maxCount: 8,
    minCount: 5,
    minEquityWeight: 0.50,
    maxEquityWeight: 0.70,
    maxLargestPosition: 0.15,
  },
  {
    mode: 'AGGRESSIVE' as const,
    minCount: 6,
    minEquityWeight: 0.70,
    maxEquityWeight: 0.95,
    maxLargestPosition: 0.25,
  },
];

interface DecisionPacket {
  decisionId: string;
  status: string;
  proposedTrades: Array<{
    symbol: string;
    assetClass: string;
    side: string;
    quantityOrAmountCents: number;
    targetWeightPercent: number;
    rationale: string;
  }>;
}

describe.each(CASES)('operating mode $mode — proposedTrades shape', (testCase) => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded({
        operatingMode: testCase.mode,
        capitalAmount: 100_000,
        mandateLevel: 'DISCRETIONARY',
      }),
      withProfileSnapshot(),
    ]);
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it(`agents respect ${testCase.mode} envelope`, async () => {
    const eb = new EventBridgeClient(ctx);

    // Publish MANDATE_ISSUED with the desired operatingMode — the natural
    // chain (mandate-projector → MandateSnapshot:INSERT → CDC →
    // MANDATE_SNAPSHOT_CREATED → SF) propagates operatingMode into the SF
    // state via Direct DDB GetItem (LookupMandateSnapshot).
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_ISSUED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        mandateId: `e2e-mandate-${Date.now()}`,
        level: 'DISCRETIONARY',
        status: 'ACTIVE',
        operatingMode: testCase.mode,
        effectiveDate: new Date().toISOString(),
      },
    });

    // Poll getDecisionHistory until a packet appears for this tenant with
    // non-empty proposedTrades — the SF must complete the agent pipeline first.
    const bff = bffClient(ctx, tenant);
    const packet = await pollForCompletedPacket(bff, tenant.tenantId);

    const equityTrades = packet.proposedTrades.filter((t) => t.assetClass === 'EQUITY');
    const equityWeight = equityTrades.reduce((sum, t) => sum + (t.targetWeightPercent ?? 0), 0) / 100;
    const largestPositionWeight = equityTrades.length > 0
      ? Math.max(...equityTrades.map((t) => (t.targetWeightPercent ?? 0) / 100))
      : 0;
    const count = packet.proposedTrades.length;

    // eslint-disable-next-line no-console
    console.log(`[Phase2] mode=${testCase.mode} count=${count} equityWeight=${equityWeight.toFixed(2)} largestPositionWeight=${largestPositionWeight.toFixed(2)}`);

    if ('maxCount' in testCase && testCase.maxCount !== undefined) {
      expect(count).toBeLessThanOrEqual(testCase.maxCount);
    }
    if ('minCount' in testCase && testCase.minCount !== undefined) {
      expect(count).toBeGreaterThanOrEqual(testCase.minCount);
    }
    expect(equityWeight).toBeGreaterThanOrEqual(testCase.minEquityWeight);
    expect(equityWeight).toBeLessThanOrEqual(testCase.maxEquityWeight);
    expect(largestPositionWeight).toBeLessThanOrEqual(testCase.maxLargestPosition);
  }, 480_000);
});

async function pollForCompletedPacket(
  bff: ReturnType<typeof bffClient>,
  tenantId: string,
): Promise<DecisionPacket> {
  // Pattern mirrors withLiveDecision (apps/e2e-feature-tests/src/helpers/fixtures.ts):
  // poll getDecisionHistory, then re-fetch full packet via getDecision.
  const deadline = Date.now() + PACKET_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const history = await bff.advisory.query<{
      getDecisionHistory: { items: Array<{ decisionId: string; status: string }> };
    }>(
      `query History { getDecisionHistory(limit: 5) { items { decisionId status } } }`,
      {},
    );
    const items = history.getDecisionHistory?.items ?? [];
    for (const item of items) {
      const detail = await bff.advisory.query<{ getDecision: DecisionPacket | null }>(
        `query GetDecision($id: ID!) {
          getDecision(decisionId: $id) {
            decisionId status
            proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
          }
        }`,
        { id: item.decisionId },
      );
      const packet = detail.getDecision;
      if (packet && packet.proposedTrades.length > 0) {
        return packet;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`No DecisionPacket with non-empty proposedTrades materialized for tenantId=${tenantId} within ${PACKET_TIMEOUT_MS}ms`);
}
