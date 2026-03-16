import { logger, type BusEvent } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { ProposedTrade } from '../service-domain/models';
import {
  createAgentNode,
  invokeGraph,
  createFallbackNodeMap,
  AGENT_TYPES,
  type AgentNodeMap,
  type DecisionStateType,
  type ServiceUnavailableResponse,
} from '@nestfolio/agent-core';
import { DecisionRepository } from '../repositories/decision.repository';

export interface DecisionContext {
  tenantId: string;
  triggerEvent: BusEvent;
  investorProfile?: Record<string, unknown>;
  portfolioState?: Record<string, unknown>;
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

  constructor(private readonly repository: DecisionRepository) {}

  readonly executeDecisionLifecycle = this.log('executeDecisionLifecycle', async (context: DecisionContext): Promise<DecisionResult> => {
    const dpId = context.triggerEvent.id;

    // 1. Create decision packet (conditional write — returns false if already exists)
    const created = await this.repository.createDecisionPacket(
      context.tenantId,
      dpId,
      context.triggerEvent,
      context as unknown as Record<string, unknown>,
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
        context.tenantId,
        dpId,
        1,
        agentName,
        context,
        output,
        0,
      );
      await this.repository.recordReasoningOutput(context.tenantId, dpId, agentName, output);
    }

    // 4. Compose decision packet result
    const proposedTrades = this.extractTrades(agentResult);
    const explanation = this.composeExplanation(agentResult);

    // 5. Update decision status
    await this.repository.updateDecisionStatus(context.tenantId, dpId, 'AGENTS_COMPLETED', {
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

  private async runAgentPipeline(context: DecisionContext): Promise<DecisionStateType> {
    const nodeMap = {} as AgentNodeMap;
    for (const type of AGENT_TYPES) {
      nodeMap[type] = createAgentNode(type);
    }

    const result = await invokeGraph(
      { input: JSON.stringify(context) },
      { nodeMap, fallbackNodeMap: createFallbackNodeMap() },
    );

    // Handle structured "service unavailable" response from agent-core
    if ('serviceUnavailable' in result && (result as ServiceUnavailableResponse).serviceUnavailable) {
      const unavailable = result as ServiceUnavailableResponse;
      throw new Error(`Agent pipeline unavailable: ${unavailable.reason}`);
    }

    return result as DecisionStateType;
  }

  private extractTrades(result: DecisionStateType): ProposedTrade[] {
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

  private composeExplanation(result: DecisionStateType): string {
    const explain = result['explainability'] as { summary?: string };
    return explain?.summary ?? 'No explanation available.';
  }
}
