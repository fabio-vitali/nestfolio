import { logger, type BusEvent, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { ProposedTrade } from '../domain/models';
import { createOrchestrator, invokeOrchestrator, type ServiceUnavailableResponse, resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
import { AGENT_CONFIGS, DECISION_LIFECYCLE_WAVES, AGENT_TYPES } from '../agents/config';
import { DecisionLifecycleState, type DecisionLifecycleStateType } from '../agents/state';
import { FALLBACK_MAP } from '../agents/fallbacks';
import { VALIDATION_RULES } from '../agents/validation';
import { DecisionRepository } from '../repositories/decision.repository';

export interface DecisionContext {
  triggerEvent: BusEvent;
  investorProfile?: Record<string, unknown>;
  portfolioState?: Record<string, unknown>;
  requestContext: RequestContext;
}

export interface DecisionResult {
  decisionPacketId: string;
  status: 'COMPLETED' | 'FAILED' | 'DUPLICATE';
  agentOutputs: Record<string, unknown>;
  proposedTrades: ProposedTrade[];
  explanation: string;
}

export class DecisionLifecycleService {
  private readonly log = withMethodLogging('DecisionLifecycleService');

  private readonly graph = createOrchestrator({
    waves: DECISION_LIFECYCLE_WAVES,
    stateAnnotation: DecisionLifecycleState,
    agents: AGENT_CONFIGS,
    fallbacks: FALLBACK_MAP,
    validationRules: VALIDATION_RULES,
  });

  constructor(private readonly repository: DecisionRepository) {}

  readonly executeDecisionLifecycle = this.log('executeDecisionLifecycle', async (context: DecisionContext): Promise<DecisionResult> => {
    const dpId = context.triggerEvent.id;
    const ctx = context.requestContext;

    // 1. Create decision packet (conditional write — returns false if already exists)
    const created = await this.repository.createDecisionPacket(
      dpId,
      context.triggerEvent,
      context as unknown as Record<string, unknown>,
      ctx,
    );

    if (!created) {
      logger.info('Duplicate decision packet, skipping', { dpId, eventId: context.triggerEvent.id });
      return {
        decisionPacketId: dpId,
        status: 'DUPLICATE',
        agentOutputs: {},
        proposedTrades: [],
        explanation: '',
      };
    }

    // 2. Run agent pipeline
    const agentResult = await this.runAgentPipeline(context);

    // 3. Build agentOutputs record from typed result and record invocations
    const agentOutputs: Record<string, unknown> = {};
    for (const agentName of AGENT_TYPES) {
      const output = agentResult[agentName];
      agentOutputs[agentName] = output;
      await this.repository.recordAgentInvocation(
        dpId,
        1,
        agentName,
        context,
        output,
        0,
        ctx,
      );
      await this.repository.recordReasoningOutput(dpId, agentName, output, ctx);
    }

    // 4. Compose decision packet result
    const proposedTrades = this.extractTrades(agentResult);
    const explanation = this.composeExplanation(agentResult);

    // 5. Update decision status
    await this.repository.updateDecisionStatus(ctx.tenantId, dpId, 'AGENTS_COMPLETED', {
      agentOutputs,
      proposedTrades,
      explanation,
    });

    logger.info('Decision lifecycle completed', { dpId, tradeCount: proposedTrades.length });

    return {
      decisionPacketId: dpId,
      status: 'COMPLETED',
      agentOutputs,
      proposedTrades,
      explanation,
    };
  });

  private async runAgentPipeline(context: DecisionContext): Promise<DecisionLifecycleStateType> {
    const runtimeUrl = await resolveAgentRuntimeUrl();

    if (runtimeUrl) {
      return invokeRemoteRuntime<DecisionLifecycleStateType>(runtimeUrl, context);
    }

    const result = await invokeOrchestrator(this.graph, { input: JSON.stringify(context) });

    if ('serviceUnavailable' in result && (result as ServiceUnavailableResponse).serviceUnavailable) {
      const unavailable = result as ServiceUnavailableResponse;
      throw new Error(`Agent pipeline unavailable: ${unavailable.reason}`);
    }

    return result as DecisionLifecycleStateType;
  }

  private extractTrades(result: DecisionLifecycleStateType): ProposedTrade[] {
    const rebalance = result['rebalance-planner'] as {
      trades?: Array<{ ticker: string; action: string; quantity: number }>;
    };
    return (rebalance?.trades ?? []).map((t) => ({
      symbol: t.ticker,
      assetClass: 'EQUITY',
      side: t.action === 'buy' ? ('BUY' as const) : ('SELL' as const),
      quantityOrAmountCents: t.quantity,
      targetWeightPercent: 0,
      rationale: `${t.action.toUpperCase()} ${t.ticker}`,
    }));
  }

  private composeExplanation(result: DecisionLifecycleStateType): string {
    const explain = result['explainability'] as { summary?: string };
    return explain?.summary ?? 'No explanation available.';
  }
}
