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
  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;
  let marketIntelligenceTrap: AgentTraceTrap<'marketIntelligence'>;
  let narrativeTrap: AgentTraceTrap<'advisoryNarrative'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Arm BEFORE any fixture — onboarded() publishes GOAL_CREATED /
    // RISK_PROFILE_CREATED which could themselves trigger SF executions and
    // agent invocations; we want every envelope in the window captured so
    // waitFor can filter by correlationId.
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
    marketIntelligenceTrap = await AgentTraceTrap.arm(ctx, 'marketIntelligence');
    narrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('MANDATE_CREATED drives the live advisory cycle through AgentCore and surfaces a decision', async () => {
    const result = await applyFixtures(ctx, tenant, [
      withLiveDecision({ trigger: 'MANDATE_CREATED' }),
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

    // advisory-ctrl's decision-lifecycle agent runs in parallel with the SF
    // chain above (both services subscribe to MANDATE_CREATED). Fan-out means
    // the agent can emit multiple traces per decisionId under revision
    // cycles — assert on the LAST (settled) trace.
    const dlTraces = await decisionLifecycleTrap.waitFor({
      correlationId: decisionId,
      timeoutMs: 240_000,
    });
    const dlEnvelope = dlTraces[dlTraces.length - 1].envelope;

    expect(dlEnvelope.status).toBe('success');
    const dlLlmErrors = dlEnvelope.errors.filter((e) => e.kind === 'llm_error');
    expect(dlLlmErrors).toHaveLength(0);
    expect(dlEnvelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(dlEnvelope['gen_ai.invocation.latency_ms']).toBeLessThan(
      decisionLifecycleTrap.getLatencyBudget(),
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
    const narrativeTraces = await narrativeTrap.waitFor({
      correlationId: decisionId,
      timeoutMs: 120_000,
    });
    const narrative = narrativeTraces[0].envelope;

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
      narrativeTrap.getLatencyBudget(),
    );
  }, 360_000);
});
