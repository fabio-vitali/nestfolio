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
  let investorProfileTrap: AgentTraceTrap<'investorProfile'>;
  let advisoryNarrativeTrap: AgentTraceTrap<'advisoryNarrative'>;
  let marketIntelligenceTrap: AgentTraceTrap<'marketIntelligence'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Arm BEFORE any fixture — onboarded() publishes ONBOARDING_COMPLETED.
    // Subsequently withLiveDecision publishes MANDATE_ISSUED → mandate-projector
    // materialises MandateSnapshot → CDC emits MANDATE_SNAPSHOT_CREATED which
    // is the SF trigger event for first decisions. We arm before applyFixtures
    // so any envelope in the window is captured and waitFor can filter by
    // correlationId.
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
    advisoryNarrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    marketIntelligenceTrap = await AgentTraceTrap.arm(ctx, 'marketIntelligence');
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

    // investor-profile agent is invoked by decision-workflow-ctrl's SF
    // (ParallelProfiling state) with payload.decisionId = ctx.eventId, which
    // matches the decisionId advisory-bff surfaces via getDecisionHistory.
    const traces = await investorProfileTrap.waitFor({
      correlationId: decisionId,
      timeoutMs: 240_000,
    });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    // Tolerate chain_error (LangChain structured-output parser retries; these
    // trigger the agent's built-in fallback escalation, which is the
    // intended resilience path). Fail only on llm_error (Bedrock infra
    // failures: IAM, validation, quota — nothing here can route around them).
    const llmErrors = envelope.errors.filter((e) => e.kind === 'llm_error');
    expect(llmErrors).toHaveLength(0);
    expect(envelope.toolCalls).toHaveLength(0);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);

    const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
    expect(models.has('opus') || models.has('haiku') || models.has('sonnet')).toBe(true);

    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(
      investorProfileTrap.getLatencyBudget(),
    );

    const miTraces = await marketIntelligenceTrap.waitFor({
      correlationId: decisionId,
      timeoutMs: 240_000,
    });
    const miEnvelope = miTraces[0].envelope;

    expect(miEnvelope.status).toBe('success');
    const miLlmErrors = miEnvelope.errors.filter((e) => e.kind === 'llm_error');
    expect(miLlmErrors).toHaveLength(0);
    expect(miEnvelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(miEnvelope['gen_ai.invocation.latency_ms']).toBeLessThan(
      marketIntelligenceTrap.getLatencyBudget(),
    );

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
    expect(narrative.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
    expect(narrative['gen_ai.invocation.latency_ms']).toBeLessThan(
      advisoryNarrativeTrap.getLatencyBudget(),
    );
  }, 360_000);
});
