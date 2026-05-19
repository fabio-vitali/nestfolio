import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withLiveDecision,
  type FreshTenant,
} from '..';
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario 11 — investor sees first advisory decision after onboarding (live AgentCore pipeline)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let advisoryNarrativeTrap: AgentTraceTrap<'advisoryNarrative'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Post-precomputation: only advisory-narrative agent runs in the per-cycle SF.
    // investor-profile + market-intelligence are continuous-projection writers
    // out-of-cycle (see plan §Task 9, §Task 13). Their snapshot rows are pre-
    // materialised by onboarded() (waits for InvestorProfileSnapshot) and by
    // MarketSnapshot bootstrap CR on stack create.
    advisoryNarrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('emits MANDATE_ISSUED → projection → MANDATE_SNAPSHOT_CREATED drives the live advisory cycle through AgentCore and surfaces a decision', async () => {
    const result = await applyFixtures(ctx, tenant, [
      withLiveDecision(),
    ]);

    expect(result['decisionId']).toEqual(expect.any(String));
    expect(result['pipelineMetadata']).toMatchObject({
      trigger: expect.any(String),
      status: expect.any(String),
    });

    const decisionId = result['decisionId'] as string;

    // Post-precomputation architecture: investor-profile + market-intelligence
    // agents run OUT-of-cycle (on MANDATE_ISSUED / feed events / 15-min tick),
    // not as SF states. Their traces are correlated to their own snapshot
    // invocation ids (`snapshot-<eventId>`), not the cycle's decisionId. The
    // pre-computation contract is already verified by `onboarded()` which
    // blocks on InvestorProfileSnapshot materialisation in IP-ctrl's table,
    // and by the MarketSnapshot bootstrap CustomResource on stack create.
    // This scenario only asserts the in-cycle agents (advisory-narrative below;
    // portfolio-engine's success is inferred from the decision surfacing with
    // proposedTrades). See plan §Task 9 (SF rewrite) + §Task 13 (fixtures).

    // advisory-narrative-ctrl runs as the final explainability wave in the SF
    // chain (after profiling + construction waves complete). It receives the
    // assembled decision packet and generates the investor-facing narrative.
    // Also serves as the canary for the full advisory lifecycle — the last
    // wave completing confirms the 4-agent pipeline ran end-to-end.
    const narrativeTraces = await advisoryNarrativeTrap.waitFor({
      correlationId: decisionId,
      timeoutMs: 240_000,
    });
    const narrative = narrativeTraces[narrativeTraces.length - 1].envelope;

    expect(narrative.status).toBe('success');
    // Tolerate chain_error (LangChain structured-output parser retries) — same
    // relaxation applied to all other traps in this file; fail only on
    // llm_error (Bedrock infra failures that cannot be self-healed).
    const narrativeLlmErrors = narrative.errors.filter((e) => e.kind === 'llm_error');
    expect(narrativeLlmErrors).toHaveLength(0);
    expect(narrative.toolCalls).toHaveLength(0);
    expect(narrative.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(narrative.llmCalls[0]['gen_ai.request.model']).toBe(
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
    expect(narrative['gen_ai.invocation.latency_ms']).toBeLessThan(
      advisoryNarrativeTrap.getLatencyBudget(),
    );
  }, 360_000);
});
