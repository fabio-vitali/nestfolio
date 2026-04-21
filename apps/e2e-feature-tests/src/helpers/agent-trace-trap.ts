import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEventDetail } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';
import { PortfolioEngineEventTypes } from '@nestfolio/portfolio-engine-ctrl/events';
import { InvestorProfileEventTypes } from '@nestfolio/investor-profile-ctrl/events';

const AGENT_TRACE_EVENTS = {
  advisoryNarrative: {
    bus: 'advisory' as const,
    detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
  portfolioEngine: {
    bus: 'advisory' as const,
    detailType: PortfolioEngineEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
  },
  investorProfile: {
    bus: 'advisory' as const,
    detailType: InvestorProfileEventTypes.INVESTOR_PROFILE_AGENT_INVOCATION_TRACED,
  },
};

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

/**
 * Soft latency budgets (ms) — canaries for pathological regressions, NOT SLAs.
 * Override per-env via `AGENT_LATENCY_BUDGET_MS_<AGENT_KEY>`.
 */
const DEFAULT_LATENCY_BUDGETS_MS = {
  advisoryNarrative: 15_000,
  portfolioEngine: 45_000,
  decisionLifecycle: 60_000,
  investorProfile: 30_000,
  marketIntelligence: 30_000,
  onboarding: 30_000,
} as const;

export interface WaitForOptions {
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class AgentTraceTrap<K extends AgentKey> {
  private constructor(
    private readonly trap: EventBusTrap,
    public readonly agent: K,
    private readonly detailType: string,
  ) {}

  /**
   * Arm the trap. Call BEFORE any fixture or action that can invoke the agent,
   * typically at the top of beforeEach, before applyFixtures().
   */
  static async arm<K extends AgentKey>(ctx: TestContext, agent: K): Promise<AgentTraceTrap<K>> {
    const entry = AGENT_TRACE_EVENTS[agent];
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: entry.bus, detailType: entry.detailType });
    return new AgentTraceTrap(trap, agent, entry.detailType);
  }

  /**
   * Poll for trace events with the given correlationId.
   */
  async waitFor(opts: WaitForOptions): Promise<AgentTraceEventDetail[]> {
    const minCount = opts.minCount ?? 1;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    const collected: AgentTraceEventDetail[] = [];

    while (Date.now() < deadline) {
      const events = await this.trap.drain();
      for (const e of events) {
        if (e.detailType !== this.detailType) continue;
        const detail = e.detail as unknown as AgentTraceEventDetail;
        if (detail.correlationId === opts.correlationId) collected.push(detail);
      }
      if (collected.length >= minCount) return collected;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `AgentTraceTrap.waitFor timed out after ${timeoutMs}ms. ` +
        `agent=${this.agent} correlationId=${opts.correlationId} expected>=${minCount} got=${collected.length}. ` +
        `Common cause: .arm() was called AFTER the trigger that invokes the agent. ` +
        `Move .arm() earlier in beforeEach (before applyFixtures or any agent-triggering mutation).`,
    );
  }

  getLatencyBudget(): number {
    const envKey = `AGENT_LATENCY_BUDGET_MS_${this.agent.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    const override = process.env[envKey];
    const parsed = override ? Number.parseInt(override, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LATENCY_BUDGETS_MS[this.agent];
  }
}
