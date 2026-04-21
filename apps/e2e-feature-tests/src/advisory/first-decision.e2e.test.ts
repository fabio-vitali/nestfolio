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

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Arm BEFORE any fixture — onboarded() publishes GOAL_CREATED /
    // RISK_PROFILE_CREATED which could themselves trigger SF executions and
    // investor-profile invocations if cross-wired; we want every envelope in
    // the window captured so waitFor can filter by correlationId.
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
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
  }, 300_000);
});
