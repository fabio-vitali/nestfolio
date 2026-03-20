export interface AgentInvocation {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: 'portfolio-construction' | 'rebalance-planner';
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export interface ReasoningOutput {
  readonly invocationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly agentName: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly createdAt: string;
}

export interface ProposedTrade {
  readonly tradeId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly action: 'BUY' | 'SELL' | 'REBALANCE';
  readonly instrument: string;
  readonly targetWeight: number;
  readonly currentWeight: number;
  readonly quantity: number | null;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface PortfolioSnapshot {
  readonly tenantId: string;
  readonly snapshotDate: string;
  readonly holdings: ReadonlyArray<{
    readonly instrument: string;
    readonly weight: number;
    readonly value: number;
  }>;
  readonly totalValue: number;
}
